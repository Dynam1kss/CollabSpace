import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, encodeCellKey, SYNC_MSG, SYNC_STRATEGY_MISMATCH } from 'shared';
import type { SyncStrategy } from 'shared';
import { app } from '../src/app';
import { addMember } from './helpers';
import {
  cellRoomSize,
  roomSize,
  setSyncStrategyOfRooms,
  syncStrategyOfRooms,
  sweepDeadSockets,
  tryUpgradeBoardRoom,
} from '../src/boards/board-rooms';
import { prisma } from '../src/prisma';

// той самий роутинг апгрейду, що в index.ts, лише на випадковому порту
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
});

let counter = 0;
async function user() {
  counter += 1;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: `room${counter}@test.local`, password: 'password123', displayName: 'Тест' });
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  return { cookie, email: `room${counter}@test.local`, agent: request.agent(app).set('Cookie', cookie) };
}

function connect(boardId: string, cookie?: string) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/boards/${boardId}`, {
    headers: cookie ? { cookie } : {},
  });
  sockets.push(ws);
  return ws;
}

function opened(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

// відмова на апгрейді приходить як unexpected-response з http-статусом
function rejected(ws: WebSocket) {
  return new Promise<number>((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('error', () => resolve(-1));
  });
}

// кадр стратегії прилітає першим у кожному сокеті, і до присутності він
// стосунку не має — тести нижче чекають roster/join/leave, тому пропускаємо
function nextMessage(ws: WebSocket, timeoutMs = 300) {
  return new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf[0] === SYNC_MSG.STRATEGY) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(buf);
    };
    ws.on('message', onMessage);
  });
}

// кадри присутності (roster/join/leave) прилітають самі по собі й до обміну
// документом стосунку не мають — тести нижче чекають саме на свої
function nextSyncMessage(ws: WebSocket, timeoutMs = 300) {
  return new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf[0] >= SYNC_MSG.ROSTER) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(buf);
    };
    ws.on('message', onMessage);
  });
}

// чекаємо саме потрібний тип кадру: у сокеті можуть висіти ще не розібрані
// ретрансляції, і «наступне повідомлення» легко виявиться не тим
function nextOfType(ws: WebSocket, type: number, timeoutMs = 1000) {
  return new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      resolve(null);
    }, timeoutMs);
    const onMessage = (data: unknown) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf[0] !== type) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(buf);
    };
    ws.on('message', onMessage);
  });
}

const strategyFrame = (strategy: SyncStrategy) =>
  Buffer.concat([Buffer.from([SYNC_MSG.STRATEGY]), Buffer.from(JSON.stringify({ strategy }), 'utf8')]);

// id учасника потрібен для patch-ролі; у user() його нема, тому дістаємо з бази
async function editorUserId(u: { email: string }) {
  const found = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true } });
  return found!;
}

async function boardWithMembers() {
  const owner = await user();
  const editor = await user();
  const viewer = await user();
  const board = await owner.agent.post('/api/boards').send({ title: 'Кімната' });
  const boardId = board.body.id as string;
  await addMember(owner, boardId, editor, 'EDITOR');
  await addMember(owner, boardId, viewer, 'VIEWER');
  return { boardId, owner, editor, viewer };
}

describe('кімнати дошок поверх ws', () => {
  it('без куки — 401, чужому — 404, учаснику — open', async () => {
    const { boardId, editor } = await boardWithMembers();
    const stranger = await user();
    expect(await rejected(connect(boardId))).toBe(401);
    expect(await rejected(connect(boardId, stranger.cookie))).toBe(404);
    expect(await rejected(connect('no-such-board', editor.cookie))).toBe(404);
    await opened(connect(boardId, editor.cookie));
    expect(roomSize(boardId)).toBe(1);
  });

  it('запрошений, але ще не прийняв — у кімнату не пускає', async () => {
    const { boardId, owner } = await boardWithMembers();
    const guest = await user();
    await owner.agent.post(`/api/boards/${boardId}/members`).send({ email: guest.email, role: 'EDITOR' });
    expect(await rejected(connect(boardId, guest.cookie))).toBe(404);
    await guest.agent.post(`/api/invites/${boardId}/accept`);
    await opened(connect(boardId, guest.cookie));
  });

  it('update редактора летить усім іншим як є, собі — ні; глядача — нікому', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, editor.cookie);
    const v = connect(boardId, viewer.cookie);
    await Promise.all([opened(a), opened(b), opened(v)]);
    expect(roomSize(boardId)).toBe(3);

    const bytes = Buffer.from([0, 7, 8, 9]);
    a.send(bytes);
    const [gotB, gotV, gotA] = await Promise.all([
      nextSyncMessage(b),
      nextSyncMessage(v),
      nextSyncMessage(a),
    ]);
    expect(gotB && Buffer.compare(gotB, bytes)).toBe(0);
    expect(gotV && Buffer.compare(gotV, bytes)).toBe(0);
    expect(gotA).toBeNull();

    v.send(Buffer.from([0, 1, 2]));
    expect(await Promise.all([nextSyncMessage(a), nextSyncMessage(b)])).toEqual([null, null]);
    // і підроблена «відповідь» від глядача теж
    v.send(Buffer.from([2, 0, 0, 0, 1, 5]));
    expect(await Promise.all([nextSyncMessage(a), nextSyncMessage(b)])).toEqual([null, null]);
  });

  it('sync-запит іде найстаршому редактору з id новачка, відповідь — лише новачкові', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const v = connect(boardId, viewer.cookie); // найстарший, але глядач — відповідати не може
    await opened(v);
    const a = connect(boardId, owner.cookie);
    await opened(a);
    const b = connect(boardId, editor.cookie);
    await opened(b);

    b.send(Buffer.from([1, 42, 43]));
    const [toA, toV] = await Promise.all([nextSyncMessage(a), nextSyncMessage(v)]);
    expect(toV).toBeNull();
    expect(toA).not.toBeNull();
    expect(toA![0]).toBe(1);
    expect(toA!.length).toBe(1 + 4 + 2);
    expect([...toA!.subarray(5)]).toEqual([42, 43]);

    const reply = Buffer.concat([Buffer.from([2]), toA!.subarray(1, 5), Buffer.from([9, 9, 9])]);
    a.send(reply);
    const [toB, toV2, toA2] = await Promise.all([nextSyncMessage(b), nextSyncMessage(v), nextSyncMessage(a)]);
    expect(toB && [...toB]).toEqual([2, 9, 9, 9]);
    expect(toV2).toBeNull();
    expect(toA2).toBeNull();

    // запит, коли редакторів нема — порожня відповідь самому питальнику
    const v2 = connect(boardId, viewer.cookie);
    await opened(v2);
    a.close();
    b.close();
    await new Promise((r) => setTimeout(r, 100));
    v2.send(Buffer.from([1, 1]));
    const [toVagain, toV2self] = await Promise.all([nextSyncMessage(v), nextSyncMessage(v2)]);
    expect(toVagain).toBeNull();
    expect(toV2self && [...toV2self]).toEqual([2]);
  });

  it('присутність несе підпис, час коннекту й відколи людина на дошці', async () => {
    const { boardId, owner, viewer } = await boardWithMembers();
    await owner.agent.patch('/api/me').send({ bio: 'малюю схеми' });
    const before = Date.now();

    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const me = JSON.parse((await rosterA)!.subarray(1).toString()).members[0];

    expect(me.bio).toBe('малюю схеми');
    // час коннекту серверний — з нього рахується «на дошці N хв»
    expect(me.joinedAt).toBeGreaterThanOrEqual(before);
    expect(me.joinedAt).toBeLessThanOrEqual(Date.now());
    // у власника рядка учасника нема — відлік іде від створення дошки
    expect(Date.parse(me.memberSince)).toBeLessThanOrEqual(Date.now());

    // у запрошеного — його власний рядок, не дошка
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextMessage(v);
    await opened(v);
    const members = JSON.parse((await rosterV)!.subarray(1).toString()).members;
    const him = members.find((m: { role: string }) => m.role === 'VIEWER');
    expect(him.bio).toBeNull();
    expect(Date.parse(him.memberSince)).toBeGreaterThanOrEqual(Date.parse(me.memberSince));
  });

  it('роутер присутності: список при вході, join і leave решті', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    // перший у кімнаті бачить лише себе, і знає свій clientId
    const first = JSON.parse((await rosterA)!.subarray(1).toString());
    expect(first.members).toHaveLength(1);
    // фото ще нема — null, а не відсутнє поле: стілець малює букву
    expect(first.members[0]).toMatchObject({ role: 'OWNER', displayName: 'Тест', avatarUrl: null });
    expect(first.members[0].clientId).toBe(first.you);

    // глядач заходить: йому — список із двох, власнику — подія join
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextMessage(v);
    const joinToA = nextMessage(a);
    await opened(v);
    const second = JSON.parse((await rosterV)!.subarray(1).toString());
    expect(second.members).toHaveLength(2);
    expect(second.members.map((m: { role: string }) => m.role).sort()).toEqual(['OWNER', 'VIEWER']);

    const join = (await joinToA)!;
    expect(join[0]).toBe(4);
    // глядач присутній нарівні з усіма — присутність за роллю не гейтиться
    expect(JSON.parse(join.subarray(1).toString())).toMatchObject({ role: 'VIEWER', clientId: second.you });

    // вихід глядача — власнику подія leave з тим самим clientId
    const leaveToA = nextMessage(a);
    v.close();
    const leave = (await leaveToA)!;
    expect(leave[0]).toBe(5);
    expect(JSON.parse(leave.subarray(1).toString())).toEqual({ clientId: second.you });

    // третій учасник заходить уже після виходу глядача — у списку лише живі
    const b = connect(boardId, editor.cookie);
    const rosterB = nextMessage(b);
    await opened(b);
    const third = JSON.parse((await rosterB)!.subarray(1).toString());
    expect(third.members).toHaveLength(2);
    expect(third.members.some((m: { role: string }) => m.role === 'VIEWER')).toBe(false);
  });

  it('замок на редагування: сервер дописує clientId і розсилає решті, глядача не пускає', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const me = JSON.parse((await rosterA)!.subarray(1).toString()).you as number;
    const b = connect(boardId, editor.cookie);
    await opened(b);
    await nextMessage(a); // join

    const lock = (ws: WebSocket, objectId: string | null) =>
      ws.send(Buffer.concat([Buffer.from([SYNC_MSG.LOCK]), Buffer.from(JSON.stringify({ objectId }))]));

    // зайняв
    const toB = nextMessage(b);
    lock(a, 'sticky-1');
    const got = (await toB)!;
    expect(got[0]).toBe(SYNC_MSG.LOCK);
    expect(got.readUInt32BE(1)).toBe(me);
    expect(JSON.parse(got.subarray(5).toString())).toEqual({ objectId: 'sticky-1' });

    // собі назад не прилітає
    expect(await nextMessage(a, 150)).toBeNull();

    // відпустив — те саме повідомлення з null
    const releaseToB = nextMessage(b);
    lock(a, null);
    expect(JSON.parse((await releaseToB)!.subarray(5).toString())).toEqual({ objectId: null });

    // глядач замок поставити не може: він і не редагує, а зайняти чуже міг би
    const v = connect(boardId, viewer.cookie);
    await opened(v);
    await nextMessage(a);
    await nextMessage(b);
    lock(v, 'sticky-1');
    expect(await nextMessage(a, 200)).toBeNull();
  });

  it('видиме вікно: сервер дописує clientId і шле решті, глядача пускає', async () => {
    const { boardId, owner, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const me = JSON.parse((await rosterA)!.subarray(1).toString()).you as number;
    // саме глядач возить вікном — присутність за роллю не гейтиться
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextMessage(v);
    await opened(v);
    const him = JSON.parse((await rosterV)!.subarray(1).toString()).you as number;
    await nextMessage(a); // join

    const rect = { x: -120.5, y: 40, width: 390, height: 780 };
    const toA = nextMessage(a);
    v.send(Buffer.concat([Buffer.from([SYNC_MSG.VIEWPORT]), Buffer.from(JSON.stringify(rect))]));
    const got = (await toA)!;
    expect(got[0]).toBe(SYNC_MSG.VIEWPORT);
    expect(got.readUInt32BE(1)).toBe(him);
    expect(JSON.parse(got.subarray(5).toString())).toEqual(rect);
    expect(me).not.toBe(him);

    // собі назад не прилітає
    expect(await nextMessage(v, 150)).toBeNull();
  });

  it('чат: сервер зберігає і розсилає всім, включно з автором; глядачу можна', async () => {
    const { boardId, owner, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const me = JSON.parse((await rosterA)!.subarray(1).toString()).you as number;
    const v = connect(boardId, viewer.cookie);
    await opened(v);
    await nextMessage(a); // join

    const chat = (ws: WebSocket, text: string) =>
      ws.send(Buffer.concat([Buffer.from([SYNC_MSG.CHAT]), Buffer.from(JSON.stringify({ text }))]));

    // пише саме глядач — чат за роллю не гейтиться
    const toA = nextMessage(a);
    const toV = nextMessage(v);
    chat(v, '  привіт усім  ');

    const gotA = (await toA)!;
    expect(gotA[0]).toBe(SYNC_MSG.CHAT);
    const message = JSON.parse(gotA.subarray(1).toString());
    // пробіли по краях сервер зрізає, автора бере з сокета, не з тіла
    expect(message).toMatchObject({ text: 'привіт усім', displayName: 'Тест' });
    expect(typeof message.id).toBe('string');
    expect(typeof message.createdAt).toBe('string');
    expect(message.authorId).not.toBe('');

    // на відміну від присутності, авторові його ж повідомлення вертається
    const echoed = (await toV)!;
    expect(JSON.parse(echoed.subarray(1).toString())).toEqual(message);
    expect(me).not.toBe(0);

    // і воно лягло в базу
    const stored = await prisma.chatMessage.findMany({ where: { boardId } });
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('привіт усім');
  });

  it('чат: порожнє, надто довге й покручене не проходить і в базу не лягає', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    await opened(a);
    const b = connect(boardId, editor.cookie);
    await opened(b);
    await nextMessage(a); // join

    const raw = (ws: WebSocket, body: string) =>
      ws.send(Buffer.concat([Buffer.from([SYNC_MSG.CHAT]), Buffer.from(body)]));

    raw(b, JSON.stringify({ text: '   ' }));
    raw(b, JSON.stringify({ text: 'x'.repeat(CHAT_MAX_LENGTH + 1) }));
    raw(b, JSON.stringify({ text: 42 }));
    raw(b, 'це не json');
    raw(b, JSON.stringify({ nope: 'так' }));

    expect(await nextMessage(a, 400)).toBeNull();
    expect(await prisma.chatMessage.count({ where: { boardId } })).toBe(0);

    // рівно на межі — проходить
    raw(b, JSON.stringify({ text: 'y'.repeat(CHAT_MAX_LENGTH) }));
    const got = (await nextMessage(a))!;
    expect(JSON.parse(got.subarray(1).toString()).text).toHaveLength(CHAT_MAX_LENGTH);
    expect(await prisma.chatMessage.count({ where: { boardId } })).toBe(1);
  });

  it('зміна ролі наздоганяє відкритий сокет, і то всі вкладки людини', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    await opened(a);
    // дві вкладки однієї людини — присутність рахує їх окремо, і роль теж
    const tab1 = connect(boardId, editor.cookie);
    const tab2 = connect(boardId, editor.cookie);
    await Promise.all([opened(tab1), opened(tab2)]);
    await nextMessage(a);
    await nextMessage(a);

    // поки редактор — його UPDATE долітає
    const beforeDowngrade = nextSyncMessage(a);
    tab1.send(Buffer.from([SYNC_MSG.UPDATE, 1, 2, 3]));
    expect((await beforeDowngrade)?.[0]).toBe(SYNC_MSG.UPDATE);

    // власник знижує його до глядача, сокети не чіпаючи
    const roleToTab1 = nextOfType(tab1, SYNC_MSG.ROLE);
    const roleToTab2 = nextOfType(tab2, SYNC_MSG.ROLE);
    const patch = await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: (await editorUserId(editor)).id, role: 'VIEWER' });
    expect(patch.status).toBe(200);

    // кадр про нову роль приходить в обидві вкладки
    for (const got of [(await roleToTab1)!, (await roleToTab2)!]) {
      expect(got[0]).toBe(SYNC_MSG.ROLE);
      expect(JSON.parse(got.subarray(1).toString())).toEqual({ role: 'VIEWER' });
    }

    // і головне: сервер більше не ретранслює його UPDATE, хоч сокет той самий
    tab1.send(Buffer.from([SYNC_MSG.UPDATE, 4, 5, 6]));
    tab2.send(Buffer.from([SYNC_MSG.UPDATE, 7, 8, 9]));
    expect(await nextSyncMessage(a, 300)).toBeNull();

    // повернули редактора — так само наздоганяє, без перезаходу
    const backToTab1 = nextOfType(tab1, SYNC_MSG.ROLE);
    await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: (await editorUserId(editor)).id, role: 'EDITOR' });
    expect(JSON.parse((await backToTab1)!.subarray(1).toString())).toEqual({ role: 'EDITOR' });

    const afterRestore = nextSyncMessage(a);
    tab1.send(Buffer.from([SYNC_MSG.UPDATE, 1, 1, 1]));
    expect((await afterRestore)?.[0]).toBe(SYNC_MSG.UPDATE);
  });

  it('видалення учасника виводить його з дошки живцем, з усіх вкладок', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    await opened(a);
    const tab1 = connect(boardId, editor.cookie);
    const tab2 = connect(boardId, editor.cookie);
    await Promise.all([opened(tab1), opened(tab2)]);
    await nextMessage(a);
    await nextMessage(a);
    expect(roomSize(boardId)).toBe(3);

    const kickedTab1 = nextOfType(tab1, SYNC_MSG.KICKED);
    const kickedTab2 = nextOfType(tab2, SYNC_MSG.KICKED);
    const closed1 = new Promise<number>((r) => tab1.once('close', r));
    const closed2 = new Promise<number>((r) => tab2.once('close', r));

    const removed = await owner.agent
      .delete(`/api/boards/${boardId}/members`)
      .send({ userId: (await editorUserId(editor)).id });
    expect(removed.status).toBe(204);

    // спершу пояснення, і лише потім закриття — щоб людина знала, що сталось
    expect((await kickedTab1)![0]).toBe(SYNC_MSG.KICKED);
    expect((await kickedTab2)![0]).toBe(SYNC_MSG.KICKED);
    await Promise.all([closed1, closed2]);

    // у кімнаті лишився сам власник, і він дізнався про вихід
    await new Promise((r) => setTimeout(r, 100));
    expect(roomSize(boardId)).toBe(1);

    // назад той самий сокет уже не оживе, а новий не пустять
    expect(await rejected(connect(boardId, editor.cookie))).toBe(404);
  });

  it('фото людини доходить у список присутніх', async () => {
    const { boardId, owner } = await boardWithMembers();
    const ownerId = (await editorUserId(owner)).id;
    await prisma.user.update({ where: { id: ownerId }, data: { avatarUrl: '/uploads/avatars/x/y.png' } });
    const a = connect(boardId, owner.cookie);
    const roster = nextMessage(a);
    await opened(a);
    const body = JSON.parse((await roster)!.subarray(1).toString());
    expect(body.members[0].avatarUrl).toBe('/uploads/avatars/x/y.png');
  });

  it('вихід із дошки самому теж виводить з кімнати живцем', async () => {
    const { boardId, editor } = await boardWithMembers();
    const tab = connect(boardId, editor.cookie);
    await opened(tab);
    const kicked = nextOfType(tab, SYNC_MSG.KICKED);
    const closed = new Promise<number>((r) => tab.once('close', r));

    expect((await editor.agent.post(`/api/boards/${boardId}/leave`)).status).toBe(204);
    expect((await kicked)![0]).toBe(SYNC_MSG.KICKED);
    await closed;
    expect(await rejected(connect(boardId, editor.cookie))).toBe(404);
  });

  it('стілець розсилається решті з дописаним clientId, глядачу теж можна', async () => {
    const { boardId, owner, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    await opened(a);
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextMessage(v);
    await opened(v);
    const idV = JSON.parse((await rosterV)!.subarray(1).toString()).you as number;
    await nextMessage(a); // join

    const toA = nextOfType(a, SYNC_MSG.SEAT);
    v.send(Buffer.concat([Buffer.from([SYNC_MSG.SEAT]), Buffer.from(JSON.stringify({ x: -12.5, y: 40 }))]));
    const got = (await toA)!;
    expect(got.readUInt32BE(1)).toBe(idV);
    expect(JSON.parse(got.subarray(5).toString())).toEqual({ x: -12.5, y: 40 });

    // собі назад не вертається — як і решта присутності
    expect(await nextOfType(v, SYNC_MSG.SEAT, 200)).toBeNull();
  });

  it('голос: вхід у розмову переспівують новачку, а про нього кажуть решті', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const idA = JSON.parse((await rosterA)!.subarray(1).toString()).you as number;

    const b = connect(boardId, editor.cookie);
    const rosterB = nextMessage(b);
    await opened(b);
    const idB = JSON.parse((await rosterB)!.subarray(1).toString()).you as number;
    await nextMessage(a); // join b

    const voice = (ws: WebSocket, inVoice: boolean) =>
      ws.send(Buffer.concat([Buffer.from([SYNC_MSG.VOICE_STATE]), Buffer.from(JSON.stringify({ inVoice }))]));

    // A заходить перший: переспівувати нема кого, але B про це чує
    const toB = nextOfType(b, SYNC_MSG.VOICE_STATE);
    voice(a, true);
    const heard = (await toB)!;
    expect(heard.readUInt32BE(1)).toBe(idA);
    expect(JSON.parse(heard.subarray(5).toString())).toEqual({ inVoice: true });

    // B заходить другим — і має отримати кадр про A, якого пропустив
    const catchUp = nextOfType(b, SYNC_MSG.VOICE_STATE);
    const toA = nextOfType(a, SYNC_MSG.VOICE_STATE);
    voice(b, true);
    const about = (await catchUp)!;
    expect(about.readUInt32BE(1)).toBe(idA);
    expect(JSON.parse(about.subarray(5).toString())).toEqual({ inVoice: true });
    expect((await toA)!.readUInt32BE(1)).toBe(idB);

    // глядач заходить у розмову нарівні з усіма — роль тут не питають
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextMessage(v);
    await opened(v);
    const idV = JSON.parse((await rosterV)!.subarray(1).toString()).you as number;
    const vLearnsA = nextOfType(v, SYNC_MSG.VOICE_STATE);
    const aLearnsV = nextOfType(a, SYNC_MSG.VOICE_STATE);
    voice(v, true);
    expect([idA, idB]).toContain((await vLearnsA)!.readUInt32BE(1));
    expect((await aLearnsV)!.readUInt32BE(1)).toBe(idV);

    // вихід із розмови розлітається так само
    const leaveToA = nextOfType(a, SYNC_MSG.VOICE_STATE);
    voice(v, false);
    const left = (await leaveToA)!;
    expect(left.readUInt32BE(1)).toBe(idV);
    expect(JSON.parse(left.subarray(5).toString())).toEqual({ inVoice: false });
  });

  it('голос: sdp і кандидати йдуть рівно адресату, з підміненим clientId', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    const idA = JSON.parse((await rosterA)!.subarray(1).toString()).you as number;
    const b = connect(boardId, editor.cookie);
    const rosterB = nextMessage(b);
    await opened(b);
    const idB = JSON.parse((await rosterB)!.subarray(1).toString()).you as number;
    const c = connect(boardId, viewer.cookie);
    await opened(c);
    await nextMessage(a);
    await nextMessage(a);

    // A шле offer саме B: у кадрі лежить id адресата
    const addressed = (type: number, target: number, payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload));
      const frame = Buffer.alloc(5 + body.length);
      frame[0] = type;
      frame.writeUInt32BE(target, 1);
      body.copy(frame, 5);
      return frame;
    };

    const toB = nextOfType(b, SYNC_MSG.VOICE_SDP);
    const toC = nextOfType(c, SYNC_MSG.VOICE_SDP, 400);
    a.send(addressed(SYNC_MSG.VOICE_SDP, idB, { type: 'offer', sdp: 'v=0 тест' }));

    const got = (await toB)!;
    // сервер підмінив «кому» на «від кого»
    expect(got.readUInt32BE(1)).toBe(idA);
    expect(JSON.parse(got.subarray(5).toString())).toEqual({ type: 'offer', sdp: 'v=0 тест' });
    // третьому не дісталось нічого — кадр адресний, не широкомовний
    expect(await toC).toBeNull();

    // кандидат так само
    const iceToA = nextOfType(a, SYNC_MSG.VOICE_ICE);
    b.send(addressed(SYNC_MSG.VOICE_ICE, idA, { candidate: 'cand', sdpMid: '0', sdpMLineIndex: 0 }));
    const ice = (await iceToA)!;
    expect(ice.readUInt32BE(1)).toBe(idB);
    expect(JSON.parse(ice.subarray(5).toString())).toMatchObject({ candidate: 'cand' });

    // неіснуючий адресат і кадр самому собі просто нікуди не йдуть
    a.send(addressed(SYNC_MSG.VOICE_SDP, 999999, { type: 'offer', sdp: 'x' }));
    a.send(addressed(SYNC_MSG.VOICE_SDP, idA, { type: 'offer', sdp: 'x' }));
    expect(await nextOfType(a, SYNC_MSG.VOICE_SDP, 300)).toBeNull();
    expect(await nextOfType(b, SYNC_MSG.VOICE_SDP, 300)).toBeNull();
  });

  it('привид у списку присутніх: жнець шле LEAVE тим, хто лишився', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    const watcher = connect(boardId, owner.cookie);
    const rosterW = nextMessage(watcher);
    await opened(watcher);
    await rosterW;

    const ghost = connect(boardId, editor.cookie);
    const joinToWatcher = nextMessage(watcher);
    await opened(ghost);
    const ghostId = JSON.parse((await joinToWatcher)!.subarray(1).toString()).clientId as number;
    expect(roomSize(boardId)).toBe(2);

    // так вмирає зʼєднання за тунелем: клієнта вже нема, але сокет на сервері
    // лишився «відкритим» і FIN не приходить — сам сервер про це не дізнається
    ghost.pause();

    // поки жнець не відпрацював, привид висить у кімнаті
    expect(roomSize(boardId)).toBe(2);

    const leaveToWatcher = nextMessage(watcher, 2000);
    sweepDeadSockets();
    await new Promise((r) => setTimeout(r, 100));
    sweepDeadSockets();

    const leave = (await leaveToWatcher)!;
    expect(leave[0]).toBe(SYNC_MSG.LEAVE);
    expect(JSON.parse(leave.subarray(1).toString())).toEqual({ clientId: ghostId });
    expect(roomSize(boardId)).toBe(1);
  });

  it('мертвий сокет не блокує sync-запит іншим', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    // найстарший редактор у кімнаті — і саме він зараз «помре»
    const dead = connect(boardId, owner.cookie);
    await opened(dead);
    const alive = connect(boardId, editor.cookie);
    await opened(alive);
    // обрив без FIN: клієнт перестає читати сокет, тому pong не приходить,
    // а сервер далі вважає зʼєднання відкритим
    dead.pause();

    // поки сервер не помітив — запит новачка йде мертвому і губиться
    const newcomer = connect(boardId, editor.cookie);
    await opened(newcomer);
    newcomer.send(Buffer.from([1, 5]));
    expect(await nextSyncMessage(alive)).toBeNull();

    // два такти без pong — сервер рве зʼєднання сам. пауза між тактами
    // обовʼязкова: живі встигають відповісти pong і скинути лічильник
    sweepDeadSockets();
    await new Promise((r) => setTimeout(r, 100));
    sweepDeadSockets();
    await new Promise((r) => setTimeout(r, 150));
    expect(roomSize(boardId)).toBe(2);

    // тепер той самий запит доходить до живого редактора
    newcomer.send(Buffer.from([1, 5]));
    const got = await nextSyncMessage(alive);
    expect(got).not.toBeNull();
    expect(got![0]).toBe(1);
    expect([...got!.subarray(5)]).toEqual([5]);
  });

  it('нема кому відповідати — сервер сам шле порожню відповідь', async () => {
    const { boardId, viewer } = await boardWithMembers();
    const v = connect(boardId, viewer.cookie);
    await opened(v);
    v.send(Buffer.from([1, 7]));
    const got = await nextSyncMessage(v);
    expect(got && [...got]).toEqual([2]);
  });

  it('показати свій вид: редактора сервер не слухає, власника — так', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, editor.cookie);
    const v = connect(boardId, viewer.cookie);
    await Promise.all([opened(a), opened(b), opened(v)]);

    const showView = (ws: WebSocket, body: object) =>
      ws.send(Buffer.concat([Buffer.from([SYNC_MSG.SHOW_VIEW]), Buffer.from(JSON.stringify(body))]));

    // кадр від редактора не доїжджає ні до кого, хоч кнопки в нього й нема
    const toOwner = nextOfType(a, SYNC_MSG.SHOW_VIEW, 200);
    const toViewer = nextOfType(v, SYNC_MSG.SHOW_VIEW, 200);
    showView(b, { centerX: 1, centerY: 2, scale: 1 });
    expect(await toOwner).toBeNull();
    expect(await toViewer).toBeNull();

    // а від власника — всім, і з його clientId спереду
    const [gotB, gotV] = [nextOfType(b, SYNC_MSG.SHOW_VIEW), nextOfType(v, SYNC_MSG.SHOW_VIEW)];
    showView(a, { centerX: 10, centerY: 20, scale: 2 });
    const frameB = (await gotB)!;
    expect(frameB).not.toBeNull();
    expect(JSON.parse(frameB.subarray(5).toString())).toMatchObject({ centerX: 10, centerY: 20, scale: 2 });
    expect(await gotV).not.toBeNull();
  });

  it('показати свій вид вибраним: кадр іде лише тим, чий userId у targets', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const editorId = (await editorUserId(editor)).id;
    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, editor.cookie);
    // друга вкладка того самого редактора: адресуємо людину, а не сокет
    const b2 = connect(boardId, editor.cookie);
    const v = connect(boardId, viewer.cookie);
    await Promise.all([opened(a), opened(b), opened(b2), opened(v)]);

    const gotB = nextOfType(b, SYNC_MSG.SHOW_VIEW);
    const gotB2 = nextOfType(b2, SYNC_MSG.SHOW_VIEW);
    const gotV = nextOfType(v, SYNC_MSG.SHOW_VIEW, 300);
    a.send(
      Buffer.concat([
        Buffer.from([SYNC_MSG.SHOW_VIEW]),
        Buffer.from(JSON.stringify({ centerX: 5, centerY: 6, scale: 1, targets: [editorId] })),
      ]),
    );
    expect(await gotB).not.toBeNull();
    expect(await gotB2).not.toBeNull();
    expect(await gotV).toBeNull();
  });

  it('відкат: кадр отримує вся кімната, writer — найстарший редактор; без редакторів — null', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    // глядач зайшов першим — writer він однаково бути не може
    const v = connect(boardId, viewer.cookie);
    const rosterV = nextOfType(v, SYNC_MSG.ROSTER);
    await opened(v);
    await rosterV;
    const e = connect(boardId, editor.cookie);
    const rosterE = nextOfType(e, SYNC_MSG.ROSTER);
    await opened(e);
    const editorId = JSON.parse((await rosterE)!.subarray(1).toString()).you as number;
    const o = connect(boardId, owner.cookie);
    await opened(o);

    const version = await owner.agent.post(`/api/boards/${boardId}/versions`).send({ label: 'точка' });
    const got = [v, e, o].map((ws) => nextOfType(ws, SYNC_MSG.RESTORED));
    await owner.agent.post(`/api/boards/${boardId}/versions/${version.body.id}/restore`).expect(204);
    // той, хто відкочував, отримує той самий кадр, що й решта
    for (const frame of await Promise.all(got)) {
      expect(JSON.parse(frame!.subarray(1).toString())).toEqual({ writer: editorId });
    }

    // редактори пішли — лишився глядач, і писати в документ нікому
    e.close();
    o.close();
    await new Promise((r) => setTimeout(r, 100));
    const alone = nextOfType(v, SYNC_MSG.RESTORED);
    await owner.agent.post(`/api/boards/${boardId}/versions/${version.body.id}/restore`).expect(204);
    expect(JSON.parse((await alone)!.subarray(1).toString())).toEqual({ writer: null });
  });

  it('close прибирає сокет, порожня кімната зникає', async () => {
    const { boardId, owner, editor } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, editor.cookie);
    await Promise.all([opened(a), opened(b)]);
    expect(roomSize(boardId)).toBe(2);
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(roomSize(boardId)).toBe(1);
    b.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(roomSize(boardId)).toBe(0);
  });
});

describe('кімнати клітинок (стратегія 3)', () => {
  const cellMsg = (type: number, cell: string, body: number[] = []) =>
    Buffer.concat([Buffer.from([type]), Buffer.from(encodeCellKey(cell)), Buffer.from(body)]);
  const subscribe = (ws: WebSocket, add: string[], remove: string[] = []) =>
    ws.send(
      Buffer.concat([Buffer.from([SYNC_MSG.CELL_SUBSCRIBE]), Buffer.from(JSON.stringify({ add, remove }))]),
    );
  // усі кадри вмісту клітинок за вікно часу — щоб довести, що НЕ прийшло нічого
  const collectCell = (ws: WebSocket, ms = 250) =>
    new Promise<Buffer[]>((resolve) => {
      const got: Buffer[] = [];
      const on = (data: unknown) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf[0] >= SYNC_MSG.CELL_SUBSCRIBE && buf[0] <= SYNC_MSG.CELL_RESET) got.push(buf);
      };
      ws.on('message', on);
      setTimeout(() => {
        ws.off('message', on);
        resolve(got);
      }, ms);
    });
  const settle = () => new Promise((r) => setTimeout(r, 60));

  async function three() {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const b = connect(boardId, editor.cookie);
    const v = connect(boardId, viewer.cookie);
    await Promise.all([opened(a), opened(b), opened(v)]);
    return { boardId, a, b, v };
  }

  it('правка клітинки доходить лише до її передплатників', async () => {
    const { a, b, v } = await three();
    subscribe(a, ['0:0']);
    subscribe(b, ['5:5']);
    subscribe(v, ['0:0']);
    await settle();
    const toB = collectCell(b);
    const toV = nextOfType(v, SYNC_MSG.CELL_UPDATE);
    const toA = collectCell(a);
    a.send(cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [9, 9, 9]));
    expect([...(await toV)!]).toEqual([...cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [9, 9, 9])]);
    expect(await toB).toHaveLength(0);
    // собі — нічого
    expect(await toA).toHaveLength(0);
  });

  it('після виходу з клітинки правки з неї більше не приходять', async () => {
    const { a, b } = await three();
    subscribe(a, ['0:0']);
    subscribe(b, ['0:0']);
    await settle();
    const first = nextOfType(b, SYNC_MSG.CELL_UPDATE);
    a.send(cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [1]));
    expect(await first).not.toBeNull();
    subscribe(b, [], ['0:0']);
    await settle();
    const after = collectCell(b);
    a.send(cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [2]));
    expect(await after).toHaveLength(0);
  });

  it('глядач не пише; у клітинку без передплати не пише ніхто', async () => {
    const { a, b, v } = await three();
    subscribe(a, ['0:0']);
    subscribe(v, ['0:0']);
    subscribe(b, ['1:0']);
    await settle();
    const toA = collectCell(a);
    v.send(cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [7]));
    // b не передплачений на 0:0 — його кадр туди не йде
    b.send(cellMsg(SYNC_MSG.CELL_UPDATE, '0:0', [8]));
    expect(await toA).toHaveLength(0);
  });

  it('sync-запит іде найстаршому редактору саме цієї клітинки, відповідь — лише тому, хто питав', async () => {
    const { a, b, v } = await three();
    subscribe(a, ['0:0']);
    subscribe(b, ['5:5']);
    await settle();
    // a спершу сам синхронізується — лише тоді він може відповідати іншим
    const own = nextOfType(a, SYNC_MSG.CELL_SYNC_REPLY);
    a.send(cellMsg(SYNC_MSG.CELL_SYNC_REQUEST, '0:0', [0]));
    await own;
    subscribe(v, ['0:0']);
    await settle();
    const toA = nextOfType(a, SYNC_MSG.CELL_SYNC_REQUEST);
    const toB = collectCell(b);
    v.send(cellMsg(SYNC_MSG.CELL_SYNC_REQUEST, '0:0', [0]));
    const req = (await toA)!;
    // [23][id:4][len][cell][sv]
    const requesterId = req.readUInt32BE(1);
    expect([...req.subarray(5)]).toEqual([...cellMsg(0, '0:0', [0]).subarray(1)]);
    expect(await toB).toHaveLength(0);

    const reply = nextOfType(v, SYNC_MSG.CELL_SYNC_REPLY);
    const idBytes = Buffer.alloc(4);
    idBytes.writeUInt32BE(requesterId);
    a.send(
      Buffer.concat([
        Buffer.from([SYNC_MSG.CELL_SYNC_REPLY]),
        idBytes,
        Buffer.from(encodeCellKey('0:0')),
        Buffer.from([4, 2]),
      ]),
    );
    expect([...(await reply)!]).toEqual([...cellMsg(SYNC_MSG.CELL_SYNC_REPLY, '0:0', [4, 2])]);
  });

  it('відповідати нема кому — порожня відповідь, а глядачам клітинки CELL_RESET', async () => {
    const { a, v } = await three();
    subscribe(v, ['2:2']);
    await settle();
    subscribe(a, ['2:2']);
    await settle();
    const reply = nextOfType(a, SYNC_MSG.CELL_SYNC_REPLY);
    const reset = nextOfType(v, SYNC_MSG.CELL_RESET);
    a.send(cellMsg(SYNC_MSG.CELL_SYNC_REQUEST, '2:2', [0]));
    expect([...(await reply)!]).toEqual([...cellMsg(SYNC_MSG.CELL_SYNC_REPLY, '2:2')]);
    expect([...(await reset)!]).toEqual([...cellMsg(SYNC_MSG.CELL_RESET, '2:2')]);
  });

  it('закритий сокет зникає з кімнат клітинок', async () => {
    const { boardId, a, b } = await three();
    subscribe(a, ['0:0', '1:0']);
    subscribe(b, ['0:0']);
    await settle();
    expect(cellRoomSize(boardId, '0:0')).toBe(2);
    a.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(cellRoomSize(boardId, '0:0')).toBe(1);
    expect(cellRoomSize(boardId, '1:0')).toBe(0);
  });

  it('двоє зайшли в порожню клітинку разом: другому відповідає перший, лише коли той сам синхронізований', async () => {
    const { a, b } = await three();
    subscribe(a, ['3:3']);
    subscribe(b, ['3:3']);
    await settle();
    // a ще не синхронізований — на запит b відповідає сервер, а не a
    const toA = collectCell(a);
    const replyB = nextOfType(b, SYNC_MSG.CELL_SYNC_REPLY);
    b.send(cellMsg(SYNC_MSG.CELL_SYNC_REQUEST, '3:3', [0]));
    expect([...(await replyB)!]).toEqual([...cellMsg(SYNC_MSG.CELL_SYNC_REPLY, '3:3')]);
    expect((await toA).filter((f) => f[0] === SYNC_MSG.CELL_SYNC_REQUEST)).toHaveLength(0);
    // тепер b синхронізований — запит a іде вже йому
    const toB = nextOfType(b, SYNC_MSG.CELL_SYNC_REQUEST);
    a.send(cellMsg(SYNC_MSG.CELL_SYNC_REQUEST, '3:3', [0]));
    expect(await toB).not.toBeNull();
  });
});

describe('стратегія кімнати', () => {
  const settleMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function board() {
    const owner = await user();
    const res = await owner.agent.post('/api/boards').send({ title: 'Режим' });
    return { boardId: res.body.id as string, owner };
  }

  it('перший кадр у сокеті — стратегія кімнати, і вона ж у env', async () => {
    const { boardId, owner } = await board();
    const ws = connect(boardId, owner.cookie);
    const first = new Promise<Buffer>((resolve) => {
      ws.once('message', (data) => resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)));
    });
    await opened(ws);
    const buf = await first;
    expect(buf[0]).toBe(SYNC_MSG.STRATEGY);
    expect(JSON.parse(buf.subarray(1).toString('utf8'))).toEqual({
      strategy: syncStrategyOfRooms(),
    });
  });

  it('оголосив той самий режим — сокет живий', async () => {
    const { boardId, owner } = await board();
    const ws = connect(boardId, owner.cookie);
    await opened(ws);
    ws.send(strategyFrame(syncStrategyOfRooms()));
    await settleMs(150);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(roomSize(boardId)).toBe(1);
  });

  it('оголосив інший режим — сервер рве сокет із власним кодом', async () => {
    const { boardId, owner } = await board();
    const ws = connect(boardId, owner.cookie);
    await opened(ws);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
    });
    ws.send(strategyFrame(syncStrategyOfRooms() === 'aoi' ? 'batched' : 'aoi'));
    const { code, reason } = await closed;
    expect(code).toBe(SYNC_STRATEGY_MISMATCH);
    expect(reason).toContain(syncStrategyOfRooms());
  });

  it('сміття замість стратегії — так само рве', async () => {
    const { boardId, owner } = await board();
    const ws = connect(boardId, owner.cookie);
    await opened(ws);
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(Buffer.concat([Buffer.from([SYNC_MSG.STRATEGY]), Buffer.from('не json', 'utf8')]));
    expect(await closed).toBe(SYNC_STRATEGY_MISMATCH);
  });

  it('стенд переставляє режим, і новий сокет уже чує новий', async () => {
    const was = syncStrategyOfRooms();
    try {
      setSyncStrategyOfRooms('per-event');
      const { boardId, owner } = await board();
      const ws = connect(boardId, owner.cookie);
      const first = new Promise<Buffer>((resolve) => {
        ws.once('message', (data) =>
          resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)),
        );
      });
      await opened(ws);
      expect(JSON.parse((await first).subarray(1).toString('utf8'))).toEqual({ strategy: 'per-event' });
    } finally {
      setSyncStrategyOfRooms(was);
    }
  });
});
