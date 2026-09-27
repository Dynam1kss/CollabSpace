import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { UPLOADS_DIR } from '../src/boards/images.routes';
import { prisma } from '../src/prisma';
import { addMember, registerUser } from './helpers';

// мінімальний валідний png 1×1 — щоб було що покласти на диск
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function boardWith(role?: 'EDITOR' | 'VIEWER') {
  const owner = await registerUser();
  const board = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
  if (!role) return { agent: owner.agent, boardId: board.body.id as string };
  const member = await registerUser();
  await addMember(owner, board.body.id, member, role);
  return { agent: member.agent, boardId: board.body.id as string };
}

describe('завантаження зображень', () => {
  const boardIds: string[] = [];

  afterEach(async () => {
    await prisma.user.deleteMany();
    for (const id of boardIds.splice(0)) await rm(resolve(UPLOADS_DIR, id), { recursive: true, force: true });
  });

  it('власник вантажить png — 201, url відносний, файл віддається статикою', async () => {
    const { agent, boardId } = await boardWith();
    boardIds.push(boardId);

    const res = await agent.post(`/api/boards/${boardId}/images`).set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(new RegExp(`^/uploads/${boardId}/[0-9a-f-]{36}\\.png$`));

    // image/* superagent сам буферизує в Buffer
    const file = await request(app).get(res.body.url).buffer();
    expect(file.status).toBe(200);
    expect(Buffer.compare(file.body, PNG)).toBe(0);
  });

  it('EDITOR може, VIEWER — 403, чужий — 404', async () => {
    const editor = await boardWith('EDITOR');
    boardIds.push(editor.boardId);
    expect(
      (
        await editor.agent
          .post(`/api/boards/${editor.boardId}/images`)
          .set('Content-Type', 'image/jpeg')
          .send(PNG)
      ).status,
    ).toBe(201);

    const viewer = await boardWith('VIEWER');
    expect(
      (
        await viewer.agent
          .post(`/api/boards/${viewer.boardId}/images`)
          .set('Content-Type', 'image/png')
          .send(PNG)
      ).status,
    ).toBe(403);

    const stranger = await registerUser();
    expect(
      (
        await stranger.agent
          .post(`/api/boards/${viewer.boardId}/images`)
          .set('Content-Type', 'image/png')
          .send(PNG)
      ).status,
    ).toBe(404);
  });

  it('не картинка — 415, порожнє тіло — 400, понад 5 МБ — 413', async () => {
    const { agent, boardId } = await boardWith();
    boardIds.push(boardId);

    const text = await agent
      .post(`/api/boards/${boardId}/images`)
      .set('Content-Type', 'text/plain')
      .send('hi');
    expect(text.status).toBe(415);
    const svg = await agent
      .post(`/api/boards/${boardId}/images`)
      .set('Content-Type', 'image/svg+xml')
      .send('<svg/>');
    expect(svg.status).toBe(415);

    const empty = await agent.post(`/api/boards/${boardId}/images`).set('Content-Type', 'image/png');
    expect(empty.status).toBe(400);

    const big = await agent
      .post(`/api/boards/${boardId}/images`)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
  });
});
