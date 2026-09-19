import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

async function boardWithViewer() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
  await owner.agent
    .post(`/api/boards/${board.body.id}/members`)
    .send({ email: viewer.payload.email, role: 'VIEWER' });
  return { owner, viewer, boardId: board.body.id as string };
}

describe('місце на дошці', () => {
  it('поки не сідав — null, не 404', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent.get(`/api/boards/${board.body.id}/seat`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ seat: null });
  });

  it('put зберігає, get віддає те саме; повторний put — той самий рядок', async () => {
    const { owner, boardId } = await boardWithViewer();

    expect((await owner.agent.put(`/api/boards/${boardId}/seat`).send({ x: 10.5, y: -20 })).status).toBe(204);
    expect((await owner.agent.get(`/api/boards/${boardId}/seat`)).body).toEqual({
      seat: { x: 10.5, y: -20 },
    });

    const before = await prisma.boardSeat.findFirst({ where: { boardId } });
    await owner.agent.put(`/api/boards/${boardId}/seat`).send({ x: 99, y: 1 });
    const after = await prisma.boardSeat.findFirst({ where: { boardId } });
    expect(after!.id).toBe(before!.id);
    expect(after!.x).toBe(99);
  });

  it('у кожного своє місце, і глядач сідає нарівні з усіма', async () => {
    const { owner, viewer, boardId } = await boardWithViewer();

    await owner.agent.put(`/api/boards/${boardId}/seat`).send({ x: 1, y: 1 });
    expect((await viewer.agent.put(`/api/boards/${boardId}/seat`).send({ x: 2, y: 2 })).status).toBe(204);

    expect((await owner.agent.get(`/api/boards/${boardId}/seat`)).body.seat).toEqual({ x: 1, y: 1 });
    expect((await viewer.agent.get(`/api/boards/${boardId}/seat`)).body.seat).toEqual({ x: 2, y: 2 });
    expect(await prisma.boardSeat.count({ where: { boardId } })).toBe(2);
  });

  it('місце лежить у базі, а не в сокеті — і зникає разом із дошкою', async () => {
    const { owner, boardId } = await boardWithViewer();
    await owner.agent.put(`/api/boards/${boardId}/seat`).send({ x: 7, y: 8 });

    // саме цим воно й відрізняється від курсора: переживає і розрив, і
    // перезавантаження, бо не залежить від зʼєднання взагалі
    const stored = await prisma.boardSeat.findFirst({ where: { boardId } });
    expect(stored).toMatchObject({ x: 7, y: 8 });
    expect((await owner.agent.get(`/api/boards/${boardId}/seat`)).body.seat).toEqual({ x: 7, y: 8 });

    await owner.agent.delete(`/api/boards/${boardId}`);
    expect(await prisma.boardSeat.count({ where: { boardId } })).toBe(0);
  });

  it('чужій дошці — 404, без куки — 401, покручені координати — 400', async () => {
    const { owner, boardId } = await boardWithViewer();
    const stranger = await registerUser();

    expect((await stranger.agent.get(`/api/boards/${boardId}/seat`)).status).toBe(404);
    expect((await stranger.agent.put(`/api/boards/${boardId}/seat`).send({ x: 0, y: 0 })).status).toBe(404);
    expect((await request(app).get(`/api/boards/${boardId}/seat`)).status).toBe(401);

    for (const body of [{ x: 'ліворуч', y: 0 }, { x: 0 }, { x: Number.NaN, y: 0 }, {}]) {
      expect((await owner.agent.put(`/api/boards/${boardId}/seat`).send(body)).status).toBe(400);
    }
    expect(await prisma.boardSeat.count({ where: { boardId } })).toBe(0);
  });
});
