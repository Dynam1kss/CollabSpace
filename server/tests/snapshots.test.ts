import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { addMember, registerUser } from './helpers';

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

  it('locked доїжджає до бази й вертається назад', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [{ ...sticky, locked: true }] })
      .expect(204);
    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.body.objects[0].locked).toBe(true);

    // старий знімок поля не має — і не має його отримати з нізвідки
    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [sticky] })
      .expect(204);
    const plain = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(plain.body.objects[0].locked).toBeUndefined();
  });

  it('віддзеркалення картинки не губиться при збереженні', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const image = {
      id: 'img1',
      type: 'image',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
      zIndex: 0,
      createdBy: 'u1',
      createdAt: '2026-09-17T00:00:00.000Z',
      url: '/api/images/x.png',
      flipX: true,
      flipY: false,
    };

    await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [image] })
      .expect(204);
    const res = await agent.get(`/api/boards/${board.body.id}/snapshot`);
    expect(res.body.objects[0]).toMatchObject({ flipX: true, flipY: false });
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
    await addMember(owner, board.body.id, editor, 'EDITOR');
    await addMember(owner, board.body.id, viewer, 'VIEWER');

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

describe('снепшот частинами (стратегія 3)', () => {
  const at = (id: string, x: number, y: number) => ({ ...sticky, id, x, y });

  it('put з cells замінює лише ці клітинки, решту дошки не чіпає', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    // 0:0, 5:0 і 0:5 — три далекі клітинки
    await agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [at('a', 10, 10), at('b', 10000, 10), at('c', 10, 10000)] });

    // клієнт бачить лише 0:0: пересунув «a» всередині неї й додав «d» там же
    const res = await agent
      .put(`/api/boards/${id}/snapshot`)
      .send({ objects: [at('a', 300, 300), at('d', 900, 900)], cells: ['0:0'] });
    expect(res.status).toBe(204);

    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string; x: number }[];
    expect(got.map((o) => o.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(got.find((o) => o.id === 'a')!.x).toBe(300);
  });

  it('видалення в своїй клітинці лягає, чужі клітинки цілі', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('a', 10, 10), at('b', 10000, 10)] });
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [], cells: ['0:0'] });
    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string }[];
    expect(got.map((o) => o.id)).toEqual(['b']);
  });

  it('чужу клітинку з переліченими не переписати', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const id = board.body.id as string;
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('b', 10000, 10)] });
    // клієнт тримає 0:0, але підсунув свою версію «b» із 5:0
    await agent.put(`/api/boards/${id}/snapshot`).send({ objects: [at('b', 10500, 10)], cells: ['0:0'] });
    const got = (await agent.get(`/api/boards/${id}/snapshot`)).body.objects as { id: string; x: number }[];
    expect(got).toHaveLength(1);
    expect(got[0].x).toBe(10000);
  });

  it('зіпсований ключ клітинки — 400', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Велика' });
    const res = await agent
      .put(`/api/boards/${board.body.id}/snapshot`)
      .send({ objects: [], cells: ['0;0'] });
    expect(res.status).toBe(400);
  });
});
