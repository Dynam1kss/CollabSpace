import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, SYNC_MSG } from 'shared';
import { app } from '../src/app';
import { roomSize, sweepDeadSockets, tryUpgradeBoardRoom } from '../src/boards/board-rooms';
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

function nextMessage(ws: WebSocket, timeoutMs = 300) {
  return new Promise<Buffer | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
    });
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
  await owner.agent.post(`/api/boards/${boardId}/members`).send({ email: editor.email, role: 'EDITOR' });
  await owner.agent.post(`/api/boards/${boardId}/members`).send({ email: viewer.email, role: 'VIEWER' });
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

  it('роутер присутності: список при вході, join і leave решті', async () => {
    const { boardId, owner, editor, viewer } = await boardWithMembers();
    const a = connect(boardId, owner.cookie);
    const rosterA = nextMessage(a);
    await opened(a);
    // перший у кімнаті бачить лише себе, і знає свій clientId
    const first = JSON.parse((await rosterA)!.subarray(1).toString());
    expect(first.members).toHaveLength(1);
    expect(first.members[0]).toMatchObject({ role: 'OWNER', displayName: 'Тест' });
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
