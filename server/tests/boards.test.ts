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

  it('зміна ролі на місці: той самий рядок, нові права', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;

    await owner.agent
      .post(`/api/boards/${boardId}/members`)
      .send({ email: member.payload.email, role: 'EDITOR' });
    const before = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });

    const res = await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({ userId: member.user.id, role: 'VIEWER' });

    // саме зміна рядка, а не видалення з повторним заведенням
    const after = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });
    expect(after!.id).toBe(before!.id);
    expect(after!.role).toBe('VIEWER');

    // права справді поїхали за роллю: глядачу писати вже не можна
    const save = await member.agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [] });
    expect(save.status).toBe(403);

    // і назад
    await owner.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'EDITOR' });
    expect((await member.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] })).status).toBe(204);
  });

  it('роль міняє лише власник, і лише наявному учаснику', async () => {
    const owner = await registerUser();
    const member = await registerUser();
    const stranger = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    const boardId = board.body.id as string;
    await owner.agent
      .post(`/api/boards/${boardId}/members`)
      .send({ email: member.payload.email, role: 'EDITOR' });

    // учасник-редактор ролями не розпоряджається
    const byMember = await member.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(byMember.status).toBe(403);

    // чужому дошки не видно взагалі
    const byStranger = await stranger.agent
      .patch(`/api/boards/${boardId}/members`)
      .send({ userId: member.user.id, role: 'VIEWER' });
    expect(byStranger.status).toBe(404);

    // кого нема в списку — тому й міняти нема чого; власника в списку теж нема
    expect(
      (await owner.agent.patch(`/api/boards/${boardId}/members`).send({ userId: stranger.user.id, role: 'VIEWER' }))
        .status,
    ).toBe(404);
    expect(
      (await owner.agent.patch(`/api/boards/${boardId}/members`).send({ userId: owner.user.id, role: 'VIEWER' }))
        .status,
    ).toBe(404);

    // покручене тіло
    expect(
      (await owner.agent.patch(`/api/boards/${boardId}/members`).send({ userId: member.user.id, role: 'BOSS' }))
        .status,
    ).toBe(400);
    expect((await owner.agent.patch(`/api/boards/${boardId}/members`).send({ role: 'VIEWER' })).status).toBe(400);

    // роль учасника після всіх спроб не змінилась
    const row = await prisma.boardMember.findFirst({ where: { boardId, userId: member.user.id } });
    expect(row!.role).toBe('EDITOR');
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
