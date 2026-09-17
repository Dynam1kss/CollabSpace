import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

const sticky = {
  id: 'obj1',
  type: 'sticky',
  x: 10,
  y: 20,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-09-17T00:00:00.000Z',
  text: 'привіт',
  fillColor: '#fef08a',
  textColor: '#1f2937',
};

const connector = {
  id: 'obj2',
  type: 'connector',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  zIndex: 1,
  createdBy: 'u1',
  createdAt: '2026-09-17T00:00:00.000Z',
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  strokeColor: '#1f2937',
  strokeWidth: 2,
  arrowEnd: true,
};

describe('снепшот дошки', () => {
  it('нова дошка — порожній масив, не 404', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ objects: [], updatedAt: null });
  });

  it('put зберігає, get віддає те саме; повторний put — upsert', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const put = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [sticky, connector] });
    expect(put.status).toBe(204);

    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    // стікер без column (як у снепшотах до канбану) проходить і повертається з null
    expect(res.body.objects).toEqual([{ ...sticky, column: null }, connector]);
    expect(typeof res.body.updatedAt).toBe('string');

    const put2 = await agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] });
    expect(put2.status).toBe(204);
    const res2 = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res2.body.objects).toEqual([{ ...sticky, column: null }]);
    expect(await prisma.boardSnapshot.count({ where: { boardId: board.body.id } })).toBe(1);
  });

  it('невалідний обʼєкт — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, type: 'unicorn' }] });
    expect(res.status).toBe(400);
    const missing = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, text: 5 }] });
    expect(missing.status).toBe(400);
  });

  it('чужа дошка — 404 і на get, і на put', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    expect((await stranger.agent.get(`/api/boards/${board.body.id}/snapshot`)).status).toBe(404);
    expect(
      (await stranger.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [] })).status,
    ).toBe(404);
  });

  it('EDITOR пише, VIEWER лише читає (403)', async () => {
    const owner = await registerUser();
    const editor = await registerUser();
    const viewer = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    await owner.agent
      .post(`/api/boards/${board.body.id}/members`)
      .send({ email: editor.payload.email, role: 'EDITOR' });
    await owner.agent
      .post(`/api/boards/${board.body.id}/members`)
      .send({ email: viewer.payload.email, role: 'VIEWER' });

    expect(
      (await editor.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] })).status,
    ).toBe(204);

    const viewerGet = await viewer.agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(viewerGet.status).toBe(200);
    expect(viewerGet.body.objects).toHaveLength(1);
    expect(
      (await viewer.agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [] })).status,
    ).toBe(403);
  });

  it('видалення дошки забирає й снепшот', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    await agent.put(`/api/boards/${board.body.id}/snapshot`).send({ objects: [sticky] });
    await agent.delete(`/api/boards/${board.body.id}`);
    expect(await prisma.boardSnapshot.count()).toBe(0);
  });
});
