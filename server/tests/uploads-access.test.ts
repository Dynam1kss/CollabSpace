import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { UPLOADS_DIR } from '../src/boards/images.routes';
import { registerUser } from './helpers';

// /uploads роздавалась усім, хто вгадав шлях. Тепер — за тими самими
// правилами, що й сама дошка

afterEach(async () => {
  await prisma.user.deleteMany();
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function boardWithImage() {
  const { agent } = await registerUser();
  const board = await agent.post('/api/boards').send({ title: 'Дошка' });
  const boardId = board.body.id as string;
  const dir = resolve(UPLOADS_DIR, boardId);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'pic.png'), png);
  return { agent, boardId, url: `/uploads/${boardId}/pic.png` };
}

describe('доступ до /uploads', () => {
  it('без авторизації картинку дошки не віддаємо', async () => {
    const { url } = await boardWithImage();
    await request(app).get(url).expect(401);
  });

  it('учасник дошки бачить її картинку', async () => {
    const { agent, url } = await boardWithImage();
    const res = await agent.get(url);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(png.length);
  });

  it('стороння людина до чужої дошки не дістається', async () => {
    const { url } = await boardWithImage();
    const stranger = await registerUser();
    const res = await stranger.agent.get(url);
    expect(res.status).toBe(404);
  });

  it('спільні теки (аватари, прев’ю) видимі будь-кому залогіненому', async () => {
    await mkdir(resolve(UPLOADS_DIR, 'link-preview'), { recursive: true });
    await writeFile(resolve(UPLOADS_DIR, 'link-preview', 'p.png'), png);
    const someone = await registerUser();
    await someone.agent.get('/uploads/link-preview/p.png').expect(200);
    // але не анонімові
    await request(app).get('/uploads/link-preview/p.png').expect(401);
  });
});
