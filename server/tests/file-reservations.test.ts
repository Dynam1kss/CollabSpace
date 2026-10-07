import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SYNC_MSG } from 'shared';
import type { FileUsageMessage } from 'shared';
import { app } from '../src/app';
import { tryUpgradeBoardRoom } from '../src/boards/board-rooms';
import { boardQuotaUsage } from '../src/boards/file-quota';
import { resetHolds } from '../src/boards/file-holds';
import { env } from '../src/env';
import { prisma } from '../src/prisma';

// Резерви місця живуть за ЗʼЄДНАННЯМ: поки той, хто видалив картку, сидить на
// дошці, місце тримається (він ще може натиснути ctrl+z), і це бачать усі.
// Пішов — місце звільнилось для всіх у ту ж мить

const httpServer = createServer(app);
httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  if (!tryUpgradeBoardRoom(req, socket, head, pathname)) socket.destroy();
});
let port = 0;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await prisma.user.deleteMany();
  resetHolds();
});

let counter = 0;
async function user() {
  counter += 1;
  const email = `hold${counter}@test.local`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email, password: 'password123', displayName: 'Тест' });
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  return { cookie, email, agent: request.agent(app).set('Cookie', cookie) };
}

function connect(boardId: string, cookie: string) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/boards/${boardId}`, { headers: { cookie } });
  sockets.push(ws);
  return ws;
}

const opened = (ws: WebSocket) =>
  new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

// чекаємо саме кадр зайнятості — присутність і стратегія летять тим самим сокетом
function nextUsage(ws: WebSocket, timeoutMs = 1500) {
  return new Promise<FileUsageMessage | null>((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(data: Buffer) {
      const buf = Buffer.from(data);
      if (buf[0] !== SYNC_MSG.FILE_USAGE) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(JSON.parse(buf.subarray(1).toString('utf8')) as FileUsageMessage);
    }
    ws.on('message', onMessage);
  });
}

const holdFrame = (fileIds: string[]) =>
  Buffer.concat([Buffer.from([SYNC_MSG.FILE_HOLD]), Buffer.from(JSON.stringify({ fileIds }), 'utf8')]);

const closed = (ws: WebSocket) =>
  new Promise<void>((resolve) => {
    ws.once('close', () => resolve());
    ws.close();
  });

async function boardWithFile(size: number) {
  const owner = await user();
  const other = await user();
  const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
  const boardId = board.body.id as string;
  await owner.agent.post(`/api/boards/${boardId}/members`).send({ email: other.email, role: 'EDITOR' });
  await other.agent.post(`/api/invites/${boardId}/accept`);
  const up = await owner.agent
    .post(`/api/boards/${boardId}/files`)
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', 'a.bin')
    .send(Buffer.alloc(size, 7));
  resetHolds(); // короткий резерв самого завантаження нас тут не цікавить
  return { owner, other, boardId, fileId: up.body.id as string };
}

describe('резерви місця під файли', () => {
  it('двоє бачать те саме число; резерв одного видно другому', async () => {
    const size = env.fileMaxBytes;
    const { owner, other, boardId, fileId } = await boardWithFile(size);

    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, other.cookie);
    await Promise.all([opened(a), opened(b)]);

    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(0);

    // перший «видалив картку» — тобто взяв файл на себе
    const sawIt = nextUsage(b);
    a.send(holdFrame([fileId]));
    const pushed = await sawIt;

    // другий побачив зайняте місце, не роблячи нічого
    expect(pushed).not.toBeNull();
    expect(pushed!.usedBytes).toBe(size);
    expect(pushed!.quotaBytes).toBe(env.boardFilesMaxBytes);
    // і сервер рахує так само — це те саме число, що вирішує відмову
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(size);
  });

  it('той, хто тримав, пішов — місце звільнилось для решти в ту ж мить', async () => {
    const size = env.fileMaxBytes;
    const { owner, other, boardId, fileId } = await boardWithFile(size);

    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, other.cookie);
    await Promise.all([opened(a), opened(b)]);

    const held = nextUsage(b);
    a.send(holdFrame([fileId]));
    expect((await held)?.usedBytes).toBe(size);

    const released = nextUsage(b);
    await closed(a);
    expect((await released)?.usedBytes).toBe(0);
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(0);
  });

  it('підказка й поріг відмови — одне число', async () => {
    const size = env.fileMaxBytes;
    const { owner, boardId, fileId } = await boardWithFile(size);
    const a = connect(boardId, owner.cookie);
    await opened(a);
    a.send(holdFrame([fileId]));
    // даємо кадру дійти
    await new Promise((r) => setTimeout(r, 200));

    // те, що показала б підказка
    const shown = await owner.agent.get(`/api/boards/${boardId}/files`);
    expect(shown.body.usedBytes).toBe(size);

    // і рівно на цьому числі сервер відмовляє
    const refused = await owner.agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'b.bin')
      .send(Buffer.alloc(size, 7));
    expect(refused.status).toBe(413);
    expect(refused.body.error.usedBytes).toBe(shown.body.usedBytes);
    expect(refused.body.error.totalBytes).toBe(shown.body.quotaBytes);
  });
});
