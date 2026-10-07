import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import {
  CHAT_MAX_LENGTH,
  CURSOR_BYTES,
  decodeCellKey,
  encodeCellKey,
  isSyncStrategy,
  SYNC_MSG,
  SYNC_REQUESTER_ID_BYTES,
  SYNC_STRATEGY_MISMATCH,
} from 'shared';
import type {
  BoardRole,
  CellSubscribeMessage,
  FileHoldMessage,
  FileUsageMessage,
  PresenceMember,
  RestoredMessage,
  RosterMessage,
  SyncStrategy,
  SyncStrategyMessage,
} from 'shared';
import { env } from '../env';
import { verifyAuthToken } from '../auth/auth.service';
import { AUTH_COOKIE, parseCookies } from '../cookies';
import { getBoardAccess, getUserCard } from './boards.service';
import { clearHolds, heldFileIds, setHolds } from './file-holds';
import { boardQuotaUsage } from './file-quota';
import { saveChatMessage } from './chat.service';
import type { BoardAccess } from './boards.service';

// кімната = дошка; сервер не тримає Y.Doc і не декодує yjs — лише
// ретранслює байти. id сокета потрібен, щоб відповідь на sync-запит
// повернулась саме тому, хто питав, а не всім
interface Client {
  id: number;
  boardId: string;
  role: BoardAccess['role'];
  roleGrantedBy: string | null;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  // час підключення саме цього сокета — з нього рахується «на дошці N хв».
  // окремого трекера присутності не заводимо: сокет і є присутність, а
  // впаде він — запис зникне разом з ним
  joinedAt: number;
  memberSince: Date;
  // чи людина зараз у голосовій розмові. Тримаємо тут, щоб новачок дізнався
  // склад розмови одразу на вході, а не питав окремим кадром
  inVoice: boolean;
}

// примусові заборони від адміністратора. Ключ — дошка й людина, а не сокет:
// інакше перезавантаження сторінки знімало б їх саме собою. Памʼять процесу,
// без бази: це модераторська дія «тут і зараз», і переживати перезапуск
// сервера їй не обовʼязково
interface ForcedVoice {
  mute: boolean;
  deafen: boolean;
  // яким був примусовий мікрофон до заборони чути: знімаючи заборону,
  // повертаємо саме його, а не просто вмикаємо мікрофон
  muteBeforeDeafen: boolean;
}

const forcedVoice = new Map<string, ForcedVoice>();
const forcedKey = (boardId: string, userId: string) => `${boardId}:${userId}`;

function forcedFor(boardId: string, userId: string): ForcedVoice {
  return (
    forcedVoice.get(forcedKey(boardId, userId)) ?? { mute: false, deafen: false, muteBeforeDeafen: false }
  );
}

// той самий журнал, що й у клієнта: коли обʼєкти зникають, послідовність
// треба читати з обох боків одночасно
function diag(event: string, data: Record<string, unknown>) {
  console.info(`[boardsync-diag] ${new Date().toISOString()} ${event}`, JSON.stringify(data));
}

export const boardRoomWss = new WebSocketServer({ noServer: true });
// Map, а не Set — порядок вставки дає «найстаршого» в кімнаті, він і відповідає новачкам
const rooms = new Map<string, Map<number, WebSocket>>();
const clients = new WeakMap<WebSocket, Client>();
// той самий лічильник пропущених pong, що в spikeSignalWss: обрив без FIN
// (згорнутий телефон, тунель, ECONNRESET) лишає сокет «відкритим» назавжди
const missedPings = new WeakMap<WebSocket, number>();
let nextClientId = 1;
const KEEPALIVE_MS = 10_000;

const PATH = /^\/ws\/boards\/([^/]+)$/;

// стратегія 3: кімнати клітинок. Та сама мапа «id → сокет» з порядком вставки
// (найстарший відповідає на sync-запит), лише ключ — (дошка, клітинка). Сокет
// один на дошку, а кімнат клітинок у нього стільки, на скільки передплачений
const cellRooms = new Map<string, Map<string, Map<number, WebSocket>>>();
const subscriptions = new WeakMap<WebSocket, Set<string>>();
// клітинки, по яких сокет уже отримав відповідь на свій sync-запит. Відповідати
// іншим може лише такий: інакше двоє, що зайшли в порожню клітинку разом,
// віддали б одне одному порожні документи, обидва вважали б клітинку
// синхронізованою — і збереження стерло б її вміст у базі
const syncedCells = new WeakMap<WebSocket, Set<string>>();

function markSynced(socket: WebSocket, cell: string) {
  let set = syncedCells.get(socket);
  if (!set) {
    set = new Set();
    syncedCells.set(socket, set);
  }
  set.add(cell);
}

export function cellRoomSize(boardId: string, cell: string) {
  return cellRooms.get(boardId)?.get(cell)?.size ?? 0;
}

function joinCell(client: Client, socket: WebSocket, cell: string) {
  let board = cellRooms.get(client.boardId);
  if (!board) {
    board = new Map();
    cellRooms.set(client.boardId, board);
  }
  let room = board.get(cell);
  if (!room) {
    room = new Map();
    board.set(cell, room);
  }
  room.set(client.id, socket);
}

function leaveCell(client: Client, cell: string) {
  const board = cellRooms.get(client.boardId);
  const room = board?.get(cell);
  if (!board || !room) return;
  room.delete(client.id);
  // порожня кімната клітинки просто зникає — як і порожня кімната дошки
  if (room.size === 0) board.delete(cell);
  if (board.size === 0) cellRooms.delete(client.boardId);
}

// [тип][len][cell] + решта — кадр клітинки без id
function cellFrame(type: number, cell: string, body?: Uint8Array) {
  const key = encodeCellKey(cell);
  return Buffer.concat([Buffer.from([type]), key, body ?? Buffer.alloc(0)]);
}

function handleCellFrame(client: Client, socket: WebSocket, buf: Buffer) {
  const subscribed = subscriptions.get(socket);
  switch (buf[0]) {
    case SYNC_MSG.CELL_SUBSCRIBE: {
      let body: Partial<CellSubscribeMessage>;
      try {
        body = JSON.parse(buf.subarray(1).toString('utf8')) as Partial<CellSubscribeMessage>;
      } catch {
        return;
      }
      const set = subscribed ?? new Set<string>();
      subscriptions.set(socket, set);
      const valid = (c: unknown): c is string => typeof c === 'string' && /^-?\d+:-?\d+$/.test(c);
      // спершу вийти, потім увійти: клітинка в обох списках (передумали) лишається
      for (const cell of (body.remove ?? []).filter(valid)) {
        if (set.delete(cell)) leaveCell(client, cell);
        syncedCells.get(socket)?.delete(cell);
      }
      for (const cell of (body.add ?? []).filter(valid)) {
        if (set.has(cell)) continue;
        set.add(cell);
        joinCell(client, socket, cell);
      }
      return;
    }

    case SYNC_MSG.CELL_UPDATE: {
      if (client.role === 'VIEWER') return;
      const key = decodeCellKey(buf, 1);
      // пише лише в клітинку, на яку передплачений: інакше в кімнаті лишились
      // би записи від того, хто на чужі відповіді ніколи не підписувався
      if (!key || !subscribed?.has(key.cell)) return;
      const room = cellRooms.get(client.boardId)?.get(key.cell);
      if (!room) return;
      for (const [id, other] of room) if (id !== client.id) send(other, buf);
      return;
    }

    case SYNC_MSG.CELL_SYNC_REQUEST: {
      const key = decodeCellKey(buf, 1);
      if (!key || !subscribed?.has(key.cell)) return;
      const room = cellRooms.get(client.boardId)?.get(key.cell);
      if (!room) return;
      // найстарший живий редактор саме цієї клітинки — правило те саме, що для дошки
      const responder = [...room.entries()].find(
        ([id, other]) =>
          id !== client.id &&
          other.readyState === WebSocket.OPEN &&
          clients.get(other)?.role !== 'VIEWER' &&
          syncedCells.get(other)?.has(key.cell),
      );
      if (!responder) {
        markSynced(socket, key.cell);
        send(socket, cellFrame(SYNC_MSG.CELL_SYNC_REPLY, key.cell));
        // редактор почне історію клітинки наново — глядачі з неї мусять
        // скинути свій документ, інакше записи тих, хто пішов, переважать нові
        if (client.role !== 'VIEWER') {
          for (const [id, other] of room) {
            if (id !== client.id && clients.get(other)?.role === 'VIEWER') {
              send(other, cellFrame(SYNC_MSG.CELL_RESET, key.cell));
            }
          }
        }
        return;
      }
      send(responder[1], withClientId(SYNC_MSG.CELL_SYNC_REQUEST, client.id, buf));
      return;
    }

    case SYNC_MSG.CELL_SYNC_REPLY: {
      if (client.role === 'VIEWER' || buf.length < 1 + SYNC_REQUESTER_ID_BYTES) return;
      const key = decodeCellKey(buf, 1 + SYNC_REQUESTER_ID_BYTES);
      if (!key) return;
      const requesterId = buf.readUInt32BE(1);
      const requester = cellRooms.get(client.boardId)?.get(key.cell)?.get(requesterId);
      if (!requester || requester === socket) return;
      const stripped = Buffer.alloc(buf.length - SYNC_REQUESTER_ID_BYTES);
      stripped[0] = SYNC_MSG.CELL_SYNC_REPLY;
      buf.copy(stripped, 1, 1 + SYNC_REQUESTER_ID_BYTES);
      markSynced(requester, key.cell);
      send(requester, stripped);
      return;
    }
  }
}

// скільки зайнято — одним числом усій кімнаті. Шлемо після будь-якої зміни
// резервів: інакше той, хто не видаляв, не побачив би, що місце зайняли
export async function broadcastFileUsage(boardId: string) {
  const room = rooms.get(boardId);
  if (!room || room.size === 0) return;
  try {
    const usage = await boardQuotaUsage(boardId);
    const body: FileUsageMessage = { usedBytes: usage.usedBytes, quotaBytes: usage.quotaBytes };
    const frame = jsonFrame(SYNC_MSG.FILE_USAGE, body);
    for (const [, socket] of room) send(socket, frame);
    if (!env.isProduction) {
      console.info(
        `[files-diag] ${new Date().toISOString()} зайнято`,
        JSON.stringify({
          boardId,
          used: usage.usedBytes,
          stored: usage.storedBytes,
          quota: usage.quotaBytes,
          резервів: heldFileIds(boardId).size,
          укімнаті: room.size,
        }),
      );
    }
  } catch {
    // не порахували — не біда: підказка оновиться наступного разу
  }
}

export function roomSize(boardId: string) {
  return rooms.get(boardId)?.size ?? 0;
}

// стратегія синхронізації кімнат. Одна на сервер: ділити її по дошках нема за
// чим — вибір робить той, хто розгортає, а не автор дошки. Жива змінна, а не
// просто env, бо стенд вимірювань переставляє її між прогонами (/api/bench/strategy)
let roomStrategy: SyncStrategy = env.syncStrategy;

export function syncStrategyOfRooms() {
  return roomStrategy;
}

// лише для стенду: прогін міряє три стратегії поспіль, і перезапускати сервер
// між ними означало б міряти ще й холодний старт
export function setSyncStrategyOfRooms(strategy: SyncStrategy) {
  roomStrategy = strategy;
  diag('стратегію кімнат переставлено', { strategy });
}

// для /api/metrics: скільки зараз сокетів і кімнат тримає сервер. дошки й
// клітинки окремо — у стратегії 3 кімнат клітинок набагато більше, ніж дошок
export function roomStats() {
  let sockets = 0;
  for (const room of rooms.values()) sockets += room.size;
  let cells = 0;
  let cellSubs = 0;
  for (const board of cellRooms.values()) {
    cells += board.size;
    for (const room of board.values()) cellSubs += room.size;
  }
  return { sockets, boardRooms: rooms.size, cellRooms: cells, cellSubscriptions: cellSubs };
}

// усі сокети однієї людини в кімнаті. Вкладок може бути кілька, і присутність
// давно рахує їх окремими записами — тому й тут чіпаємо всі, а не перший
// -ліпший: інакше в одній вкладці права поїхали б, а в сусідній ні
function socketsOfUser(boardId: string, userId: string) {
  const room = rooms.get(boardId);
  if (!room) return [];
  return [...room.values()].filter((socket) => clients.get(socket)?.userId === userId);
}

// роль у сокеті кешується з моменту підключення: rest щоразу читає базу
// наново, а тут би лишилась стара до перезаходу — і знижений редактор далі
// розсилав би UPDATE. Тому після запису в базу правимо кеш і кажемо клієнту,
// щоб той переставив і свій бік без перезавантаження
export function applyRoleChange(boardId: string, userId: string, role: BoardRole, grantedBy: string) {
  diag('зміна ролі доганяє відкриті сокети', { boardId, userId, role });
  for (const socket of socketsOfUser(boardId, userId)) {
    const client = clients.get(socket);
    if (!client) continue;
    client.role = role;
    client.roleGrantedBy = grantedBy;
    send(socket, jsonFrame(SYNC_MSG.ROLE, { role }));
  }
}

// снепшот у базі щойно замінили версією — кажемо про це всій кімнаті, і
// сокету того, хто відкочував, теж: його вкладка приймає новий стан тим самим
// шляхом, що й решта. Вміст у кадр не кладемо — у сервера немає Y.Doc, дельту
// скласти нема з чого. Замість цього призначаємо writer — одного редактора,
// який перечитає снепшот і запише його в документ; решта дістане це звичайними
// дельтами. Правило вибору те саме, що для SYNC_REQUEST: найстарший відкритий
// не-глядач
export function broadcastRestore(boardId: string) {
  const room = rooms.get(boardId);
  if (!room) return;
  const writer = [...room.values()].find(
    (socket) => socket.readyState === WebSocket.OPEN && clients.get(socket)?.role !== 'VIEWER',
  );
  const message: RestoredMessage = { writer: writer ? (clients.get(writer)?.id ?? null) : null };
  diag('відкат: розсилаю кімнаті', { boardId, у_кімнаті: room.size, writer: message.writer });
  for (const socket of room.values()) send(socket, jsonFrame(SYNC_MSG.RESTORED, message));
}

// true — шлях наш (апгрейд або відмова вже наші); false — хай роутить далі
export function tryUpgradeBoardRoom(req: IncomingMessage, socket: Duplex, head: Buffer, pathname: string) {
  const match = pathname.match(PATH);
  if (!match) return false;
  void upgrade(req, socket, head, match[1]);
  return true;
}

async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, boardId: string) {
  // та сама кука, що й у requireAuth; тут не rest, тому без json — просто рвемо
  const token = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  const userId = token ? verifyAuthToken(token) : null;
  if (!userId) {
    reject(socket, '401 Unauthorized');
    return;
  }
  const access = await getBoardAccess(boardId, userId);
  if (!access) {
    reject(socket, '404 Not Found');
    return;
  }
  const { displayName, avatarUrl, bio } = await getUserCard(userId);
  boardRoomWss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, {
      id: nextClientId++,
      boardId,
      role: access.role,
      roleGrantedBy: access.roleGrantedBy,
      userId,
      displayName,
      avatarUrl,
      bio,
      joinedAt: Date.now(),
      memberSince: access.memberSince,
      inVoice: false,
    });
    boardRoomWss.emit('connection', ws, req);
  });
}

// рядок статусу перед destroy — щоб у devtools було видно причину, а не просто обрив
function reject(socket: Duplex, status: string) {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

// присутність шлемо json-ом: ці кадри рідкі (вхід, вихід, список при
// підключенні), тому читабельність тут дорожча за байти — на відміну від
// курсорів, які підуть десятками за секунду
function jsonFrame(type: number, payload: unknown) {
  return Buffer.concat([Buffer.from([type]), Buffer.from(JSON.stringify(payload), 'utf8')]);
}

// тіло для кадрів, які збираються через withClientId: там перший байт і id
// дописуються окремо, тому лишається сам json з фіктивним першим байтом
function jsonBody(payload: unknown) {
  return Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(payload), 'utf8')]);
}

function toMember(client: Client): PresenceMember {
  return {
    clientId: client.id,
    userId: client.userId,
    displayName: client.displayName,
    avatarUrl: client.avatarUrl,
    bio: client.bio,
    joinedAt: client.joinedAt,
    memberSince: client.memberSince.toISOString(),
    role: client.role,
    roleGrantedBy: client.roleGrantedBy,
    inVoice: client.inVoice,
    forcedMute: forcedFor(client.boardId, client.userId).mute,
    forcedDeafen: forcedFor(client.boardId, client.userId).deafen,
  };
}

// адресний кадр переговорів: клієнт поклав туди clientId того, кому шле;
// міняємо його на clientId відправника й передаємо адресату. Тіло (sdp чи
// кандидат) для сервера — непрозорі байти, як і оновлення yjs
function relayToPeer(room: Map<number, WebSocket>, from: Client, buf: Buffer) {
  if (buf.length < 1 + SYNC_REQUESTER_ID_BYTES) return;
  const peer = room.get(buf.readUInt32BE(1));
  if (!peer || peer === room.get(from.id)) return;
  const framed = Buffer.from(buf);
  framed.writeUInt32BE(from.id, 1);
  send(peer, framed);
}

// виділення, замок, вікно й sync-запит ідуть далі однаково: сервер лише
// дописує спереду id відправника, у тіло не заглядаючи
function withClientId(type: number, clientId: number, buf: Buffer) {
  const framed = Buffer.alloc(1 + SYNC_REQUESTER_ID_BYTES + buf.length - 1);
  framed[0] = type;
  framed.writeUInt32BE(clientId, 1);
  buf.copy(framed, 1 + SYNC_REQUESTER_ID_BYTES, 1);
  return framed;
}

function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

// з json-тіла кадру дістаємо текст повідомлення; усе, що не схоже на текст
// або довше за дозволене, просто викидаємо. Розмір перевіряємо ДО розбору,
// щоб зіпсований клієнт не змусив парсити мегабайт
function readChatText(buf: Buffer) {
  if (buf.length > CHAT_MAX_LENGTH * 6 + 64) return null;
  try {
    const body: unknown = JSON.parse(buf.subarray(1).toString('utf8'));
    if (typeof body !== 'object' || body === null) return null;
    const { text } = body as { text?: unknown };
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > CHAT_MAX_LENGTH) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// кому показувати свій вид: null — усій кімнаті (як було до появи вибору),
// множина — лише цим людям. Зіпсоване тіло читаємо як «усім»: кадр одноразовий
// і нічого не псує, а мовчки губити його важче зрозуміти
function readShowViewTargets(buf: Buffer) {
  try {
    const body: unknown = JSON.parse(buf.subarray(1).toString('utf8'));
    if (typeof body !== 'object' || body === null) return null;
    const { targets } = body as { targets?: unknown };
    if (!Array.isArray(targets)) return null;
    return new Set(targets.filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
}

// що клієнт оголосив у кадрі STRATEGY. Сміття й зіпсований json — теж не та
// стратегія: рвемо сокет, бо писати нам такий клієнт однаково не має
function readStrategy(buf: Buffer): SyncStrategy | 'невідома' {
  try {
    const body: unknown = JSON.parse(buf.subarray(1).toString('utf8'));
    const { strategy } = (body ?? {}) as { strategy?: unknown };
    return isSyncStrategy(strategy) ? strategy : 'невідома';
  } catch {
    return 'невідома';
  }
}

// єдиний кадр, який сервер зберігає, а не ретранслює: спершу база призначає
// id і час, і вже готове повідомлення йде всім у кімнаті — разом із автором,
// бо саме з цієї відповіді він і побачить своє повідомлення
async function relayChat(client: Client, buf: Buffer) {
  const text = readChatText(buf);
  if (!text) return;
  const saved = await saveChatMessage(client.boardId, client.userId, text);
  const frame = jsonFrame(SYNC_MSG.CHAT, saved);
  // кімнату беремо наново: поки писали в базу, вона могла спорожніти й
  // зникнути, а та, що в замиканні, лишилась би від старого складу
  const room = rooms.get(client.boardId);
  if (!room) return;
  for (const [, socket] of room) send(socket, frame);
}

// власник прибрав людину з дошки. Мовчки рвати сокет не годиться — людина не
// зрозуміє, чому її раптом викинуло; тому спершу кадр, і вже по ньому
// закриття. close() шле кадр закриття після всього, що вже стало в чергу,
// тож повідомлення встигає піти
// адміністратор примусово вимкнув комусь мікрофон або звук. Розсилаємо всім
// у кімнаті: адресат виконує, решта малює замочок
export function setForcedVoice(boardId: string, userId: string, patch: Partial<ForcedVoice>) {
  const current = forcedFor(boardId, userId);
  const next = { ...current, ...patch };
  // «не чує нікого» тягне за собою й мікрофон — рівно як власне вимкнення
  // звуку в клієнті. Інакше людина не чує, але говорить у порожнечу, і
  // замок на мікрофоні їй ніхто не малює
  if (patch.deafen === true && !current.deafen) {
    next.muteBeforeDeafen = current.mute;
    next.mute = true;
  }
  if (patch.deafen === false && current.deafen) {
    next.mute = current.muteBeforeDeafen;
  }
  if (!next.mute && !next.deafen) forcedVoice.delete(forcedKey(boardId, userId));
  else forcedVoice.set(forcedKey(boardId, userId), next);

  const room = rooms.get(boardId);
  if (!room) return;
  // шлемо лише те, що справді змінилось: мікрофон міг поїхати слідом за звуком
  if (next.mute !== current.mute) {
    const frame = jsonFrame(SYNC_MSG.FORCE_MUTE, { userId, on: next.mute });
    for (const [, socket] of room) send(socket, frame);
  }
  if (next.deafen !== current.deafen) {
    const frame = jsonFrame(SYNC_MSG.FORCE_DEAFEN, { userId, on: next.deafen });
    for (const [, socket] of room) send(socket, frame);
  }
}

export function kickMember(boardId: string, userId: string) {
  diag('учасника виводять з дошки', { boardId, userId });
  for (const socket of socketsOfUser(boardId, userId)) {
    send(socket, Buffer.from([SYNC_MSG.KICKED]));
    socket.close();
  }
}

boardRoomWss.on('connection', (socket) => {
  const client = clients.get(socket);
  if (!client) {
    socket.close();
    return;
  }
  let room = rooms.get(client.boardId);
  if (!room) {
    room = new Map();
    rooms.set(client.boardId, room);
  }
  // новачку — увесь список (разом із ним самим, щоб він знав свій clientId),
  // решті — лише подію про нього. Хто в кімнаті, знає сервер, тому роздає він
  const roster: RosterMessage = {
    you: client.id,
    members: [...room.values(), socket]
      .map((s) => clients.get(s))
      .filter((c): c is Client => !!c)
      .map(toMember),
  };
  for (const [, other] of room) send(other, jsonFrame(SYNC_MSG.JOIN, toMember(client)));

  room.set(client.id, socket);
  diag('до кімнати зайшли', {
    boardId: client.boardId,
    clientId: client.id,
    role: client.role,
    у_кімнаті: room.size,
  });
  missedPings.set(socket, 0);
  socket.on('pong', () => missedPings.set(socket, 0));
  // стратегія — перший кадр, ще до roster: клієнт не має створювати документи,
  // поки не знає, куди писати (журнал 05.10)
  send(socket, jsonFrame(SYNC_MSG.STRATEGY, { strategy: roomStrategy } satisfies SyncStrategyMessage));
  send(socket, jsonFrame(SYNC_MSG.ROSTER, roster));
  // після перезавантаження сторінки заборона має лишитись — тому переспівуємо
  // її новому сокету окремо, а не покладаємось на roster, який лише знімок
  const forced = forcedFor(client.boardId, client.userId);
  if (forced.mute) {
    send(socket, jsonFrame(SYNC_MSG.FORCE_MUTE, { userId: client.userId, on: true }));
  }
  if (forced.deafen) {
    send(socket, jsonFrame(SYNC_MSG.FORCE_DEAFEN, { userId: client.userId, on: true }));
  }

  socket.on('message', (data) => {
    const buf = toBuffer(data);
    if (buf.length === 0) return;
    const others = [...room.entries()].filter(([id]) => id !== client.id);

    switch (buf[0]) {
      // клієнт відзвітував, яку стратегію взяв. Збіглось — просто мовчимо; не
      // збіглось (у браузері свій ?sync= зі стенду) — рвемо сокет одразу: тихо
      // лишити його в кімнаті гірше, ніж не пустити. Він однаково нікого не
      // почує, зате виглядатиме «онлайн» (журнал 05.10)
      case SYNC_MSG.STRATEGY: {
        const announced = readStrategy(buf);
        if (announced === roomStrategy) return;
        diag('клієнт оголосив іншу стратегію — закриваю', {
          boardId: client.boardId,
          clientId: client.id,
          announced,
          room: roomStrategy,
        });
        socket.close(SYNC_STRATEGY_MISMATCH, `кімната працює у режимі ${roomStrategy}`);
        return;
      }

      case SYNC_MSG.UPDATE:
        // глядач не пише — його байти нікуди не йдуть, навіть якщо клієнт обійшов заборону
        if (client.role === 'VIEWER') return;
        for (const [, other] of others) send(other, buf);
        return;

      case SYNC_MSG.CURSOR: {
        // глядача тут не відсікаємо: він присутній і теж возить курсором.
        // Дописуємо id відправника й розсилаємо як є — сервер у координати
        // не заглядає, вони йому ні до чого
        if (buf.length !== 1 + CURSOR_BYTES - SYNC_REQUESTER_ID_BYTES) return;
        const framed = Buffer.alloc(1 + CURSOR_BYTES);
        framed[0] = SYNC_MSG.CURSOR;
        framed.writeUInt32BE(client.id, 1);
        buf.copy(framed, 1 + SYNC_REQUESTER_ID_BYTES, 1);
        for (const [, other] of others) send(other, framed);
        return;
      }

      // виділення й видиме вікно шле й глядач — це не зміна вмісту, тож роль
      // тут ні до чого
      case SYNC_MSG.SELECTION:
      case SYNC_MSG.SEAT:
      case SYNC_MSG.VIEWPORT: {
        const framed = withClientId(buf[0], client.id, buf);
        for (const [, other] of others) send(other, framed);
        return;
      }

      case SYNC_MSG.SHOW_VIEW: {
        // єдиний кадр присутності з гейтом: він смикає чужу камеру, тому
        // доступний лише власнику й адміністратору. Клієнт кнопку й так
        // ховає, але ховання — не заборона
        if (client.role !== 'OWNER' && client.role !== 'ADMIN') return;
        const targets = readShowViewTargets(buf);
        const framed = withClientId(SYNC_MSG.SHOW_VIEW, client.id, buf);
        for (const [, other] of others) {
          // у списку userId, а не clientId — усі вкладки адресата дістають кадр
          if (targets && !targets.has(clients.get(other)?.userId ?? '')) continue;
          send(other, framed);
        }
        return;
      }

      case SYNC_MSG.LOCK: {
        // на відміну від виділення, замок обмежує інших — глядачу, який і так
        // не редагує, нема чого його ставити
        if (client.role === 'VIEWER') return;
        const framed = withClientId(SYNC_MSG.LOCK, client.id, buf);
        for (const [, other] of others) send(other, framed);
        return;
      }

      case SYNC_MSG.VOICE_STATE: {
        // голос ролі не питає — глядач говорить нарівні з усіма, як і в чаті
        let body: { inVoice?: unknown };
        try {
          body = JSON.parse(buf.subarray(1).toString('utf8')) as { inVoice?: unknown };
        } catch {
          return;
        }
        if (typeof body.inVoice !== 'boolean') return;
        const joining = body.inVoice && !client.inVoice;
        client.inVoice = body.inVoice;

        // новачкові — по кадру на кожного, хто вже в розмові: далі він сам
        // вирішить, кому з них пропонувати зʼєднання, а кого дочекатись
        if (joining) {
          for (const [, other] of others) {
            const peer = clients.get(other);
            if (peer?.inVoice) {
              send(socket, withClientId(SYNC_MSG.VOICE_STATE, peer.id, jsonBody({ inVoice: true })));
            }
          }
        }
        const framed = withClientId(SYNC_MSG.VOICE_STATE, client.id, jsonBody({ inVoice: body.inVoice }));
        for (const [, other] of others) send(other, framed);
        return;
      }

      case SYNC_MSG.VOICE_SDP:
      case SYNC_MSG.VOICE_ICE:
        relayToPeer(room, client, buf);
        return;

      case SYNC_MSG.CHAT:
        // чат — не вміст дошки, тому за роллю не гейтимо: глядач пише й читає
        // нарівні з усіма, як і в присутності. Обробник асинхронний (запис у
        // базу), тому промис відпускаємо — далі черга кадрів не чекає
        void relayChat(client, buf).catch(() => {});
        return;

      case SYNC_MSG.SYNC_REQUEST: {
        // новачок просить історію — відповідає найстарший живий редактор (глядач
        // не може, бо його відповідь ми б не мали права ретранслювати).
        // readyState перевіряємо тут, а не тільки в send: мовчазна відповідь
        // «найстаршого» лишала б новачка без історії, а далі чужа дельта
        // вбивала б у нього обʼєкт (див. журнал)
        const responder = others.find(
          ([, other]) => other.readyState === WebSocket.OPEN && clients.get(other)?.role !== 'VIEWER',
        );
        // відповідати нема кому — кажемо це вголос порожньою відповіддю, інакше
        // новачок не відрізнить «я сам на дошці» від «мене не почули»
        if (!responder) {
          diag('SYNC_REQUEST: відповідати нема кому, шлю порожню', {
            boardId: client.boardId,
            clientId: client.id,
            у_кімнаті: room.size,
          });
          send(socket, Buffer.from([SYNC_MSG.SYNC_REPLY]));
          return;
        }
        diag('SYNC_REQUEST переадресовано', {
          boardId: client.boardId,
          від: client.id,
          кому: clients.get(responder[1])?.id,
        });
        send(responder[1], withClientId(SYNC_MSG.SYNC_REQUEST, client.id, buf));
        return;
      }

      case SYNC_MSG.CELL_SUBSCRIBE:
      case SYNC_MSG.CELL_UPDATE:
      case SYNC_MSG.CELL_SYNC_REQUEST:
      case SYNC_MSG.CELL_SYNC_REPLY:
        handleCellFrame(client, socket, buf);
        return;

      case SYNC_MSG.FILE_HOLD: {
        if (client.role === 'VIEWER') return;
        let body: Partial<FileHoldMessage>;
        try {
          body = JSON.parse(buf.subarray(1).toString('utf8')) as Partial<FileHoldMessage>;
        } catch {
          return;
        }
        const ids = (body.fileIds ?? []).filter((id) => typeof id === 'string').slice(0, 500);
        setHolds(client.boardId, client.id, ids);
        void broadcastFileUsage(client.boardId);
        return;
      }

      case SYNC_MSG.SYNC_REPLY: {
        if (client.role === 'VIEWER' || buf.length < 1 + SYNC_REQUESTER_ID_BYTES) return;
        const requester = room.get(buf.readUInt32BE(1));
        if (!requester || requester === socket) return;
        const stripped = Buffer.alloc(buf.length - SYNC_REQUESTER_ID_BYTES);
        stripped[0] = SYNC_MSG.SYNC_REPLY;
        buf.copy(stripped, 1, 1 + SYNC_REQUESTER_ID_BYTES);
        diag('SYNC_REPLY віддано', {
          boardId: client.boardId,
          від: client.id,
          кому: clients.get(requester)?.id,
          байтів: stripped.length - 1,
        });
        send(requester, stripped);
        return;
      }
    }
  });

  const leave = () => {
    // резерви місця під файли тримаються саме зʼєднанням: пішов — відпустив,
    // і решта кімнати одразу бачить вільне місце
    clearHolds(client.boardId, client.id);
    void broadcastFileUsage(client.boardId);
    // з кімнат клітинок — теж, інакше мертвий сокет лишався б найстаршим і
    // ковтав sync-запити новачків клітинки
    for (const cell of subscriptions.get(socket) ?? []) leaveCell(client, cell);
    subscriptions.delete(socket);
    if (!room.delete(client.id)) return;
    diag('з кімнати вийшли', { boardId: client.boardId, clientId: client.id, лишилось: room.size });
    for (const [, other] of room) send(other, jsonFrame(SYNC_MSG.LEAVE, { clientId: client.id }));
    // знімаємо з реєстру лише СВОЮ кімнату: поки цей сокет доживав, ту саму
    // дошку могли відкрити наново, і тоді в rooms уже лежить інша мапа —
    // стерти її означало б розділити кімнату надвоє, і нові учасники
    // перестали б бачити одне одного
    if (room.size === 0 && rooms.get(client.boardId) === room) rooms.delete(client.boardId);
  };
  socket.on('close', leave);
  socket.on('error', leave);
});

function send(socket: WebSocket, data: Buffer) {
  if (socket.readyState === WebSocket.OPEN) socket.send(data);
}

// два пропущені pong поспіль — рвемо самі; terminate() дає 'close', тож
// прибирання з кімнати йде звичайним шляхом. окремо від інтервалу, щоб тест
// міг прокрутити два такти без очікування
export function sweepDeadSockets() {
  for (const room of rooms.values()) {
    for (const socket of room.values()) {
      const missed = (missedPings.get(socket) ?? 0) + 1;
      if (missed >= 2) {
        socket.terminate();
        continue;
      }
      missedPings.set(socket, missed);
      socket.ping();
    }
  }
}

// unref — щоб не тримати процес у тестах
setInterval(sweepDeadSockets, KEEPALIVE_MS).unref();
