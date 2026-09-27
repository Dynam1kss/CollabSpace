import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

async function invited(role = 'EDITOR') {
  const owner = await registerUser({ displayName: 'Власниця' });
  const guest = await registerUser();
  const board = await owner.agent.post('/api/boards').send({ title: 'Запрошувальна' });
  const boardId = board.body.id as string;
  const res = await owner.agent
    .post(`/api/boards/${boardId}/members`)
    .send({ email: guest.payload.email, role });
  expect(res.status).toBe(201);
  return { owner, guest, boardId };
}

describe('запрошення на дошку', () => {
  it('поки не прийняв — доступу нема ніде', async () => {
    const { guest, boardId } = await invited();

    expect((await guest.agent.get('/api/boards')).body.boards).toHaveLength(0);
    expect((await guest.agent.get(`/api/boards/${boardId}`)).status).toBe(404);
    expect((await guest.agent.get(`/api/boards/${boardId}/snapshot`)).status).toBe(404);
    expect((await guest.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] })).status).toBe(404);
    expect((await guest.agent.get(`/api/boards/${boardId}/chat`)).status).toBe(404);
  });

  it('запрошений бачить дошку, хто кликав і яку роль дають', async () => {
    const { owner, guest, boardId } = await invited('VIEWER');

    const res = await guest.agent.get('/api/invites');
    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([
      {
        boardId,
        boardTitle: 'Запрошувальна',
        role: 'VIEWER',
        invitedBy: { displayName: 'Власниця', email: owner.payload.email },
        createdAt: expect.any(String),
      },
    ]);
    // у того, хто кликав, власних запрошень нема
    expect((await owner.agent.get('/api/invites')).body.invites).toEqual([]);
  });

  it('прийняв — дошка у списку з тією роллю, запрошення зникло', async () => {
    const { guest, boardId } = await invited('EDITOR');

    expect((await guest.agent.post(`/api/invites/${boardId}/accept`)).status).toBe(204);

    const list = await guest.agent.get('/api/boards');
    expect(list.body.boards).toHaveLength(1);
    expect(list.body.boards[0]).toMatchObject({ id: boardId, myRole: 'EDITOR' });
    expect((await guest.agent.get(`/api/boards/${boardId}`)).status).toBe(200);
    expect((await guest.agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] })).status).toBe(204);
    expect((await guest.agent.get('/api/invites')).body.invites).toEqual([]);
    // вдруге приймати нічого
    expect((await guest.agent.post(`/api/invites/${boardId}/accept`)).status).toBe(404);
  });

  it('відхилив — ні запрошення, ні рядка учасника', async () => {
    const { guest, boardId } = await invited();

    expect((await guest.agent.post(`/api/invites/${boardId}/decline`)).status).toBe(204);

    expect((await guest.agent.get('/api/invites')).body.invites).toEqual([]);
    expect(await prisma.boardMember.count({ where: { boardId, userId: guest.user.id } })).toBe(0);
    expect((await guest.agent.get(`/api/boards/${boardId}`)).status).toBe(404);
  });

  it('чуже чи неіснуюче запрошення — 404, і нічого не міняється', async () => {
    const { guest, boardId } = await invited();
    const stranger = await registerUser();

    expect((await stranger.agent.post(`/api/invites/${boardId}/accept`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/invites/${boardId}/decline`)).status).toBe(404);
    expect((await guest.agent.post('/api/invites/no-such-board/accept')).status).toBe(404);
    expect((await stranger.agent.get(`/api/boards/${boardId}`)).status).toBe(404);

    const row = await prisma.boardMember.findFirst({ where: { boardId, userId: guest.user.id } });
    expect(row!.status).toBe('PENDING');
  });

  it('прийнятого вже не відхилити через запрошення', async () => {
    const { guest, boardId } = await invited();
    await guest.agent.post(`/api/invites/${boardId}/accept`);

    expect((await guest.agent.post(`/api/invites/${boardId}/decline`)).status).toBe(404);
    expect((await guest.agent.get(`/api/boards/${boardId}`)).status).toBe(200);
  });

  it('власник бачить, хто ще не прийняв', async () => {
    const { owner, guest, boardId } = await invited();

    const before = await owner.agent.get(`/api/boards/${boardId}`);
    expect(before.body.members).toEqual([
      expect.objectContaining({ userId: guest.user.id, status: 'PENDING' }),
    ]);

    await guest.agent.post(`/api/invites/${boardId}/accept`);
    const after = await owner.agent.get(`/api/boards/${boardId}`);
    expect(after.body.members).toEqual([
      expect.objectContaining({ userId: guest.user.id, status: 'ACCEPTED' }),
    ]);
  });

  it('зміна ролі прийнятому — одразу, без нового очікування', async () => {
    const { owner, guest, boardId } = await invited('EDITOR');
    await guest.agent.post(`/api/invites/${boardId}/accept`);

    await owner.agent.patch(`/api/boards/${boardId}/members`).send({ userId: guest.user.id, role: 'VIEWER' });
    // і через повторне «додати» — це теж лише зміна ролі
    await owner.agent
      .post(`/api/boards/${boardId}/members`)
      .send({ email: guest.payload.email, role: 'ADMIN' });

    const row = await prisma.boardMember.findFirst({ where: { boardId, userId: guest.user.id } });
    expect(row).toMatchObject({ role: 'ADMIN', status: 'ACCEPTED' });
    expect((await guest.agent.get('/api/boards')).body.boards[0]).toMatchObject({ myRole: 'ADMIN' });
  });

  it('зміна ролі ще не прийнятому лишає його в очікуванні', async () => {
    const { owner, guest, boardId } = await invited('EDITOR');

    await owner.agent
      .post(`/api/boards/${boardId}/members`)
      .send({ email: guest.payload.email, role: 'VIEWER' });

    expect((await guest.agent.get('/api/invites')).body.invites[0]).toMatchObject({ role: 'VIEWER' });
    expect((await guest.agent.get(`/api/boards/${boardId}`)).status).toBe(404);
  });

  it('прибрати можна і того, хто ще не прийняв', async () => {
    const { owner, guest, boardId } = await invited();

    const res = await owner.agent.delete(`/api/boards/${boardId}/members`).send({ userId: guest.user.id });
    expect(res.status).toBe(204);
    expect((await guest.agent.get('/api/invites')).body.invites).toEqual([]);
    expect((await guest.agent.post(`/api/invites/${boardId}/accept`)).status).toBe(404);
  });

  it('старі учасники (до запрошень) доступ не втратили', async () => {
    const owner = await registerUser();
    const old = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Стара' });
    // так міграція проставила всім наявним рядкам
    await prisma.boardMember.create({
      data: { boardId: board.body.id, userId: old.user.id, role: 'EDITOR', status: 'ACCEPTED' },
    });

    expect((await old.agent.get('/api/boards')).body.boards).toHaveLength(1);
    expect((await old.agent.get(`/api/boards/${board.body.id}`)).status).toBe(200);
    expect((await old.agent.get('/api/invites')).body.invites).toEqual([]);
  });

  it('рядок без статусу за замовчуванням — запрошення, а не доступ', async () => {
    const owner = await registerUser();
    const guest = await registerUser();
    const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
    await prisma.boardMember.create({
      data: { boardId: board.body.id, userId: guest.user.id, role: 'EDITOR' },
    });

    expect((await guest.agent.get(`/api/boards/${board.body.id}`)).status).toBe(404);
  });
});
