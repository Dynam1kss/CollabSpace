import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { CHAT_MAX_LENGTH, CURSOR_BYTES, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { BoardRole, PresenceMember, RosterMessage } from 'shared';
import { verifyAuthToken } from '../auth/auth.service';
import { AUTH_COOKIE, parseCookies } from '../cookies';
import { getBoardAccess, getDisplayName } from './boards.service';
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
  return forcedVoice.get(forcedKey(boardId, userId)) ?? { mute: false, deafen: false, muteBeforeDeafen: false };
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

export function roomSize(boardId: string) {
  return rooms.get(boardId)?.size ?? 0;
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
  const displayName = await getDisplayName(userId);
  boardRoomWss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, {
      id: nextClientId++,
      boardId,
      role: access.role,
      roleGrantedBy: access.roleGrantedBy,
      userId,
      displayName,
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
