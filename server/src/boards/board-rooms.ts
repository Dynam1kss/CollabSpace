import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import { verifyAuthToken } from '../auth/auth.service';
import { AUTH_COOKIE, parseCookies } from '../cookies';
import { getBoardAccess } from './boards.service';
import type { BoardAccess } from './boards.service';

// кімната = дошка; сервер не тримає Y.Doc і не декодує yjs — лише
// ретранслює байти. id сокета потрібен, щоб відповідь на sync-запит
// повернулась саме тому, хто питав, а не всім
interface Client {
  id: number;
  boardId: string;
  role: BoardAccess['role'];
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
  boardRoomWss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, { id: nextClientId++, boardId, role: access.role });
    boardRoomWss.emit('connection', ws, req);
  });
}

// рядок статусу перед destroy — щоб у devtools було видно причину, а не просто обрив
function reject(socket: Duplex, status: string) {
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

function toBuffer(data: RawData) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
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
  room.set(client.id, socket);
  missedPings.set(socket, 0);
  socket.on('pong', () => missedPings.set(socket, 0));

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
          send(socket, Buffer.from([SYNC_MSG.SYNC_REPLY]));
          return;
        }
        const framed = Buffer.alloc(1 + SYNC_REQUESTER_ID_BYTES + buf.length - 1);
        framed[0] = SYNC_MSG.SYNC_REQUEST;
        framed.writeUInt32BE(client.id, 1);
        buf.copy(framed, 1 + SYNC_REQUESTER_ID_BYTES, 1);
        send(responder[1], framed);
        return;
      }

      case SYNC_MSG.SYNC_REPLY: {
        if (client.role === 'VIEWER' || buf.length < 1 + SYNC_REQUESTER_ID_BYTES) return;
        const requester = room.get(buf.readUInt32BE(1));
        if (!requester || requester === socket) return;
        const stripped = Buffer.alloc(buf.length - SYNC_REQUESTER_ID_BYTES);
        stripped[0] = SYNC_MSG.SYNC_REPLY;
        buf.copy(stripped, 1, 1 + SYNC_REQUESTER_ID_BYTES);
        send(requester, stripped);
        return;
      }
    }
  });

  const leave = () => {
    room.delete(client.id);
    if (room.size === 0) rooms.delete(client.boardId);
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
