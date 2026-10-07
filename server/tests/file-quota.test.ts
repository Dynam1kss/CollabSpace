import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ERROR } from 'shared';
import { env } from '../src/env';
import { prisma } from '../src/prisma';
import { FILES_DIR } from '../src/boards/files.routes';
import { boardQuotaUsage } from '../src/boards/file-quota';
import { resetHolds } from '../src/boards/file-holds';
import { sweepOrphanFiles } from '../src/boards/files.sweep';
import { registerUser } from './helpers';

// квота рахує лише те, що дошка СПРАВДІ використовує: після видалення картки
// місце має звільнитись одразу, а не чекати добового прибирача

afterEach(async () => {
  await prisma.user.deleteMany();
  resetHolds();
});

// «вийшов з дошки»: зʼєднання закрилось, резерви відпущені, а короткий резерв
// самого завантаження вже вичерпався
const leaveBoard = () => resetHolds();

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
  it('картку видалено й ніхто її не тримає — місце вільне одразу', async () => {
    const { agent, boardId } = await setup();
    const size = env.fileMaxBytes;

    const first = await upload(agent, boardId, 'a.bin', size);
    expect(first.status).toBe(201);
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(first.body.id, 'a.bin', size)] })
      .expect(204);

    // поки картка на дошці — місце зайняте
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(size);

    // картку прибрали. На дошці нікого (жодного сокета), тримати нема кому —
    // і резерв завантаження тут уже не до чого: картка побувала в знімку.
    // Хто саме тримає місце, поки сидить на дошці, перевіряє
    // file-reservations.test.ts — там є справжні зʼєднання
    await agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] }).expect(204);
    const after = await boardQuotaUsage(boardId);
    expect(after.usedBytes).toBe(0);
    expect(after.storedBytes).toBe(size);

    // файл лишився на диску — ctrl+z ще має повернути робочу картку
    expect((await agent.get(`/api/boards/${boardId}/files/${first.body.id}`)).status).toBe(200);
    expect((await upload(agent, boardId, 'b.bin', size)).status).toBe(201);
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

  it('покинуті файли місця не займають, скільки б їх не лежало на диску', async () => {
    const { agent, boardId } = await setup();
    const size = env.fileMaxBytes;
    // ллємо більше, ніж уміщує квота, але карток не ставимо й резервів немає
    for (let i = 0; i < 4; i++) {
      const res = await upload(agent, boardId, `f${i}.bin`, size);
      expect(res.status, `файл ${i}`).toBe(201);
      // автор пішов — його резерв на щойно завантажене відпущено
      leaveBoard();
    }
    const usage = await boardQuotaUsage(boardId);
    // на диску лежить більше за квоту, але зайнятого — нуль
    expect(usage.storedBytes).toBeGreaterThan(usage.quotaBytes);
    expect(usage.usedBytes).toBe(0);
    // і наступне завантаження проходить: прихованої другої межі більше немає
    expect((await upload(agent, boardId, 'more.bin', size)).status).toBe(201);
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

// саме те, що бачив власник: залив до межі, видалив усі картки, вийшов і
// зайшов — місце має бути вільне
describe('сценарії з життя', () => {
  it('A: залив до межі, видалив усі картки, вийшов — 0 зайнято', async () => {
    const { agent, boardId } = await setup();
    const piece = Math.floor(env.boardFilesMaxBytes / 3);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await upload(agent, boardId, `f${i}.bin`, piece);
      expect(res.status, `файл ${i}`).toBe(201);
      ids.push(res.body.id);
    }
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: ids.map((id) => card(id, 'f.bin', piece)) })
      .expect(204);
    // місця більше немає — і це правда
    expect((await upload(agent, boardId, 'more.bin', piece)).status).toBe(413);

    // видаляємо ВСІ картки. Сокетів тут немає, тримати нема кому — місце
    // звільняється в ту ж мить
    await agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] }).expect(204);
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(0);

    // відкат справді повертає робочу картку
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: ids.map((id) => card(id, 'f.bin', piece)) })
      .expect(204);
    expect((await agent.get(`/api/boards/${boardId}/files/${ids[0]}`)).status).toBe(200);

    // тепер прибираємо все й виходимо з дошки
    await agent.put(`/api/boards/${boardId}/snapshot`).send({ objects: [] }).expect(204);
    leaveBoard();
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(0);
    expect((await upload(agent, boardId, 'after.bin', piece)).status).toBe(201);
  });

  it('B: стара дошка з сиротами й файлом лише у версії — завантаження в межах квоти проходить', async () => {
    const { agent, boardId } = await setup();
    // колись залили багато й повидаляли: карток немає, файли лежать
    for (let i = 0; i < 4; i++) {
      expect((await upload(agent, boardId, `old${i}.bin`, env.fileMaxBytes)).status).toBe(201);
      leaveBoard();
    }
    // один із них лишився лише у збереженій версії
    const inVersion = await upload(agent, boardId, 'v.bin', env.fileMaxBytes);
    leaveBoard();
    await prisma.boardVersion.create({
      data: {
        boardId,
        label: 'стара',
        createdBy: 'u1',
        isManual: true,
        state: Buffer.from(
          JSON.stringify([card(inVersion.body.id, 'v.bin', env.fileMaxBytes)]),
          'utf8',
        ),
      },
    });

    const usage = await boardQuotaUsage(boardId);
    // на диску лежить більше за квоту, але зайнятого — нуль
    expect(usage.storedBytes).toBeGreaterThan(usage.quotaBytes);
    expect(usage.usedBytes).toBe(0);

    // і дрібний файл приймається, як і має бути на дошці без карток
    const small = await upload(agent, boardId, 's.bin', 311);
    expect(small.status).toBe(201);
  });

  it('порожня клітинка не лишає по собі посилань на файл', async () => {
    const { agent, boardId } = await setup();
    const up = await upload(agent, boardId, 'a.bin', 512);
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [card(up.body.id, 'a.bin', 512)], cells: ['0:0'] })
      .expect(204);
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(512);

    // останній обʼєкт клітинки прибрано — рядок клітинки має зникнути
    await agent
      .put(`/api/boards/${boardId}/snapshot`)
      .send({ objects: [], cells: ['0:0'] })
      .expect(204);
    expect(await prisma.boardSnapshotCell.count({ where: { boardId } })).toBe(0);
    leaveBoard();
    expect((await boardQuotaUsage(boardId)).usedBytes).toBe(0);
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
    // ніхто їх уже не тримає
    leaveBoard();
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
