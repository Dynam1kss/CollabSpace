import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ERROR } from 'shared';
import { env } from '../src/env';
import { prisma } from '../src/prisma';
import { FILES_DIR } from '../src/boards/files.routes';
import { boardQuotaUsage } from '../src/boards/file-quota';
import { sweepOrphanFiles } from '../src/boards/files.sweep';
import { registerUser } from './helpers';

// квота рахує лише те, що дошка СПРАВДІ використовує: після видалення картки
// місце має звільнитись одразу, а не чекати добового прибирача

afterEach(async () => {
  await prisma.user.deleteMany();
});

const chunk = (size: number) => Buffer.alloc(size, 7);

async function setup() {
  const { agent } = await registerUser();
  const board = await agent.post('/api/boards').send({ title: 'Дошка' });
  return { agent, boardId: board.body.id as string };
}

const card = (fileId: string, name: string, size: number) => ({
  id: `c-${fileId}`,
  type: 'file',
  x: 0,
  y: 0,
  width: 240,
  height: 76,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-07T00:00:00.000Z',
  fileId,
  name,
  size,
  mime: 'application/octet-stream',
});

async function upload(
  agent: Awaited<ReturnType<typeof setup>>['agent'],
  boardId: string,
  name: string,
  size: number,
) {
  return agent
    .post(`/api/boards/${boardId}/files`)
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', name)
    .send(chunk(size));
}

describe('квота файлів дошки', () => {
  it('видалення картки звільняє місце одразу, без чекання прибирача', async () => {
    const { agent, boardId } = await setup();
    const size = env.fileMaxBytes;

    const first = await upload(agent, boardId, 'a.bin', size);
    expect(first.status).toBe(201);
    // ставимо картку й «старимо» файл, щоб вийшов із пільгового вікна
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(first.body.id, 'a.bin', size)] })
      .expect(204);
    await prisma.boardFile.update({
      where: { id: first.body.id },
      data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    // поки картка на дошці — місця на другий такий файл немає
    const blocked = await upload(agent, boardId, 'b.bin', size);
    expect(blocked.status).toBe(413);
    expect(blocked.body.error.code).toBe(FILE_ERROR.quota);

    // прибираємо картку зі знімка — файл лишається на диску, але місце вільне
    await agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] }).expect(204);
    const after = await boardQuotaUsage(boardId);
    expect(after.usedBytes).toBe(0);
    expect(after.storedBytes).toBe(size);

    const again = await upload(agent, boardId, 'b.bin', size);
    expect(again.status).toBe(201);
  });

  it('відкат видалення повертає робочу картку: файл нікуди не дівся', async () => {
    const { agent, boardId } = await setup();
    const up = await upload(agent, boardId, 'a.bin', 1024);
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(up.body.id, 'a.bin', 1024)] })
      .expect(204);
    // видалення картки (ctrl+z поверне той самий знімок)
    await agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] }).expect(204);
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(up.body.id, 'a.bin', 1024)] })
      .expect(204);

    // файл досі віддається
    const got = await agent.get(`/api/boards/${boardId}/files/${up.body.id}`);
    expect(got.status).toBe(200);
  });

  it('відмова по квоті має свій код і числа, а не «завеликий файл»', async () => {
    const { agent, boardId } = await setup();
    const size = env.fileMaxBytes;
    await upload(agent, boardId, 'a.bin', size).then((r) => expect(r.status).toBe(201));

    const res = await upload(agent, boardId, 'b.bin', size);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe(FILE_ERROR.quota);
    expect(res.body.error.usedBytes).toBe(size);
    expect(res.body.error.totalBytes).toBe(env.boardFilesMaxBytes);

    // а завеликий файл — ІНШИЙ код
    const big = await upload(agent, boardId, 'c.bin', env.fileMaxBytes + 10);
    expect(big.body.error.code).toBe(FILE_ERROR.tooLarge);
  });

  it('жорстка стеля: цикл «завантажив — видалив» не росте на диску безмежно', async () => {
    const { agent, boardId } = await setup();
    const size = env.fileMaxBytes;
    let lastStatus = 201;
    // щоразу чистимо знімок, тож квота вільна, але збережене росте
    for (let i = 0; i < 20 && lastStatus === 201; i++) {
      const res = await upload(agent, boardId, `f${i}.bin`, size);
      lastStatus = res.status;
      await prisma.boardFile.updateMany({
        where: { boardId },
        data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
    }
    expect(lastStatus).toBe(413);
    const usage = await boardQuotaUsage(boardId);
    expect(usage.storedBytes).toBeLessThanOrEqual(usage.storedCapBytes);
  });

  it('два одночасні завантаження разом не перебирають квоту', async () => {
    const { agent, boardId } = await setup();
    // кожен сам по собі влазить, удвох — ні
    const size = env.fileMaxBytes;
    const [a, b] = await Promise.all([
      upload(agent, boardId, 'a.bin', size),
      upload(agent, boardId, 'b.bin', size),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 413]);
    const usage = await boardQuotaUsage(boardId);
    expect(usage.usedBytes).toBeLessThanOrEqual(usage.quotaBytes);
  });
});

describe('прибирач файлів-сиріт', () => {
  it('видаляє покинутий файл, лишає той, на який посилається знімок і версія', async () => {
    const { agent, boardId } = await setup();
    const kept = await upload(agent, boardId, 'kept.bin', 256);
    const inVersion = await upload(agent, boardId, 'version.bin', 256);
    const orphan = await upload(agent, boardId, 'orphan.bin', 256);

    // перший — у поточному знімку
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(kept.body.id, 'kept.bin', 256)] })
      .expect(204);
    // другий — лише у збереженій версії
    await prisma.boardVersion.create({
      data: {
        boardId,
        label: 'стара',
        createdBy: 'u1',
        isManual: true,
        state: Buffer.from(JSON.stringify([card(inVersion.body.id, 'version.bin', 256)]), 'utf8'),
      },
    });
    // усі три — давні, інакше прибирач їх не чіпає
    await prisma.boardFile.updateMany({
      where: { boardId },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
    });
    // файли на диску мають існувати, щоб видалення було справжнім
    await mkdir(FILES_DIR, { recursive: true });
    for (const id of [kept.body.id, inVersion.body.id, orphan.body.id]) {
      const row = await prisma.boardFile.findUniqueOrThrow({ where: { id } });
      await writeFile(resolve(FILES_DIR, row.storageName), chunk(16));
    }

    const removed = await sweepOrphanFiles();
    expect(removed).toBe(1);
    expect(await prisma.boardFile.findUnique({ where: { id: orphan.body.id } })).toBeNull();
    expect(await prisma.boardFile.findUnique({ where: { id: kept.body.id } })).not.toBeNull();
    expect(await prisma.boardFile.findUnique({ where: { id: inVersion.body.id } })).not.toBeNull();
  });
});
