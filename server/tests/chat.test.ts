import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_HISTORY_LIMIT } from 'shared';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { addMember, registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

// повідомлення кладемо напряму в базу: шлях відправки живе в сокеті, а тут
// перевіряється лише історія
async function seed(boardId: string, authorId: string, texts: string[]) {
  for (const [i, text] of texts.entries()) {
    await prisma.chatMessage.create({
      data: { boardId, authorId, text, createdAt: new Date(Date.UTC(2026, 8, 19, 12, 0, i)) },
    });
  }
}

async function boardWithViewer() {
  const owner = await registerUser();
  const viewer = await registerUser();
  const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
  await addMember(owner, board.body.id, viewer, 'VIEWER');
  return { owner, viewer, boardId: board.body.id as string };
}

describe('історія чату', () => {
  it('нова дошка — порожньо, не 404', async () => {
    const { agent } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });

    const res = await agent.get(`/api/boards/${board.body.id}/chat`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [] });
  });

  it('віддає від старих до нових, з імʼям автора', async () => {
    const { agent, user } = await registerUser({ displayName: 'Іван Олійник' });
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    await seed(board.body.id, user.id, ['перше', 'друге', 'третє']);

    const res = await agent.get(`/api/boards/${board.body.id}/chat`);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(['перше', 'друге', 'третє']);
    expect(res.body.messages[0]).toMatchObject({
      authorId: user.id,
      displayName: 'Іван Олійник',
      text: 'перше',
    });
    expect(typeof res.body.messages[0].createdAt).toBe('string');
  });

  it('віддає останні CHAT_HISTORY_LIMIT, а не перші', async () => {
    const { agent, user } = await registerUser();
    const board = await agent.post('/api/boards').send({ title: 'Дошка' });
    const total = CHAT_HISTORY_LIMIT + 5;
    await seed(
      board.body.id,
      user.id,
      Array.from({ length: total }, (_, i) => `msg-${i}`),
    );

    const res = await agent.get(`/api/boards/${board.body.id}/chat`);
    const texts = res.body.messages.map((m: { text: string }) => m.text);
    expect(texts).toHaveLength(CHAT_HISTORY_LIMIT);
    // обрізало з початку: найстаріші випали, найновіше лишилось останнім
    expect(texts[0]).toBe(`msg-${total - CHAT_HISTORY_LIMIT}`);
    expect(texts[texts.length - 1]).toBe(`msg-${total - 1}`);
  });

  it('глядач читає чат нарівні з усіма — за роллю не гейтимо', async () => {
    const { owner, viewer, boardId } = await boardWithViewer();
    await seed(boardId, owner.user.id, ['привіт']);

    const res = await viewer.agent.get(`/api/boards/${boardId}/chat`);
    expect(res.status).toBe(200);
    expect(res.body.messages.map((m: { text: string }) => m.text)).toEqual(['привіт']);
  });

  it('чужій дошці — 404, без куки — 401', async () => {
    const { owner, boardId } = await boardWithViewer();
    const stranger = await registerUser();
    await seed(boardId, owner.user.id, ['таємне']);

    expect((await stranger.agent.get(`/api/boards/${boardId}/chat`)).status).toBe(404);
    expect((await request(app).get(`/api/boards/${boardId}/chat`)).status).toBe(401);
  });

  it('чат зникає разом із дошкою', async () => {
    const { owner, boardId } = await boardWithViewer();
    await seed(boardId, owner.user.id, ['раз', 'два']);

    await owner.agent.delete(`/api/boards/${boardId}`);
    expect(await prisma.chatMessage.count({ where: { boardId } })).toBe(0);
  });
});
