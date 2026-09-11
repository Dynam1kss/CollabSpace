import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe('дошки — CRUD і права доступу', () => {
  it('власник створює дошку, бачить її у списку своїх', async () => {
    const { agent } = await registerUser();

    const createRes = await agent.post('/api/boards').send({ title: 'Моя дошка' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.isOwner).toBe(true);

    const listRes = await agent.get('/api/boards');
    expect(listRes.status).toBe(200);
    expect(listRes.body.boards).toHaveLength(1);
    expect(listRes.body.boards[0].id).toBe(createRes.body.id);
  });

  it('чужу дошку не видно — 404, а не 403', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();

    const board = await owner.agent.post('/api/boards').send({ title: 'Приватна дошка' });

    const res = await stranger.agent.get(`/api/boards/${board.body.id}`);
    expect(res.status).toBe(404);
  });

  it('чужу дошку не можна перейменувати', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await stranger.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Хак' });
    expect(res.status).toBe(404);
  });

  it('чужу дошку не можна видалити', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await stranger.agent.delete(`/api/boards/${board.body.id}`);
    expect(res.status).toBe(404);

    const stillThere = await owner.agent.get(`/api/boards/${board.body.id}`);
    expect(stillThere.status).toBe(200);
  });

  it('власник перейменовує і видаляє власну дошку', async () => {
    const owner = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Стара назва' });

    const renamed = await owner.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Нова назва' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe('Нова назва');

    const deleted = await owner.agent.delete(`/api/boards/${board.body.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await owner.agent.get(`/api/boards/${board.body.id}`);
    expect(afterDelete.status).toBe(404);
  });

  it('учасник з роллю EDITOR бачить дошку, але не може її перейменувати чи видалити', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Спільна дошка' });

    const addRes = await owner.agent
      .post(`/api/boards/${board.body.id}/members`)
      .send({ email: member.payload.email, role: 'EDITOR' });
    expect(addRes.status).toBe(201);

    const readRes = await member.agent.get(`/api/boards/${board.body.id}`);
    expect(readRes.status).toBe(200);

    const renameRes = await member.agent.patch(`/api/boards/${board.body.id}`).send({ title: 'Хак' });
    expect(renameRes.status).toBe(403);

    const deleteRes = await member.agent.delete(`/api/boards/${board.body.id}`);
    expect(deleteRes.status).toBe(403);

    const addMemberRes = await member.agent
      .post(`/api/boards/${board.body.id}/members`)
      .send({ email: owner.payload.email, role: 'VIEWER' });
    expect(addMemberRes.status).toBe(403);
  });

  it('видалення учасника забирає йому доступ до дошки', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });

    await owner.agent
      .post(`/api/boards/${board.body.id}/members`)
      .send({ email: member.payload.email, role: 'VIEWER' });

    const removeRes = await owner.agent
      .delete(`/api/boards/${board.body.id}/members`)
      .send({ userId: member.user.id });
    expect(removeRes.status).toBe(204);

    const afterRemove = await member.agent.get(`/api/boards/${board.body.id}`);
    expect(afterRemove.status).toBe(404);
  });
});
