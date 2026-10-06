import { readdir } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/env';
import { FILES_DIR } from '../src/boards/files.routes';
import { sanitizeFileName } from 'shared';
import { sniffMime } from '../src/boards/file-sniff';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

// як і в решті наборів: без чистки наступний прогін спіткнеться на тих самих
// адресах пошти, реєстрація впаде, і все посиплеться невиразними 401
afterEach(async () => {
  await prisma.user.deleteMany();
});

// файли дошки: межа розміру, квота, ролі, чужа дошка, небезпечні назви,
// примусове завантаження для svg/html і діапазони для відео

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

async function board(role: 'EDITOR' | 'VIEWER' | 'OWNER' = 'OWNER') {
  const owner = await registerUser();
  const created = await owner.agent.post('/api/boards').send({ title: 'Дошка' });
  const boardId = created.body.id as string;
  if (role === 'OWNER') return { agent: owner.agent, boardId };
  const other = await registerUser();
  await owner.agent
    .post(`/api/boards/${boardId}/members`)
    .send({ email: other.payload.email, role });
  await other.agent.post(`/api/invites/${boardId}/accept`);
  return { agent: other.agent, boardId };
}

describe('файли дошки', () => {
  it('редактор завантажує, метадані повертаються, тип — за байтами', async () => {
    const { agent, boardId } = await board('EDITOR');
    const res = await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      // клієнт бреше про тип — нас це не цікавить
      .set('X-File-Name', encodeURIComponent('звіт.png'))
      .send(png);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'звіт.png', mime: 'image/png', size: png.length });
    expect(res.body.boardUsedBytes).toBe(png.length);
  });

  it('глядач завантажити не може', async () => {
    const { agent, boardId } = await board('VIEWER');
    await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'a.png')
      .send(png)
      .expect(403);
  });

  it('завеликий файл — 413, і на диску нічого не лишається', async () => {
    const { agent, boardId } = await board('EDITOR');
    const before = await readdir(FILES_DIR).catch(() => []);
    const huge = Buffer.alloc(env.fileMaxBytes + 1024, 1);
    expect(env.fileMaxBytes).toBeLessThan(1024 * 1024);
    const res = await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'huge.bin')
      .send(huge);

    expect(res.status).toBe(413);
    const after = await readdir(FILES_DIR).catch(() => []);
    expect(after.length).toBe(before.length);
  });

  it('квота дошки: другий файл уже не влазить', async () => {
    const { agent, boardId } = await board('EDITOR');
    // кожен файл — рівно під межу одного файла; квота менша за три таких
    const big = Buffer.alloc(env.fileMaxBytes, 2);
    const fits = Math.floor(env.boardFilesMaxBytes / env.fileMaxBytes);
    for (let i = 0; i < fits; i++) {
      await agent
        .post(`/api/boards/${boardId}/files`)
        .set('Content-Type', 'application/octet-stream')
        .set('X-File-Name', `a${i}.bin`)
        .send(big)
        .expect(201);
    }
    // наступний уже не влазить у квоту дошки
    const res = await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'over.bin')
      .send(big);
    expect(res.status).toBe(413);
  });

  it('назва знезаражується: розділювачі, керівні символи й перевизначення напрямку', async () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd'.replace(/^\.+/, ''));
    expect(sanitizeFileName('a\u0000b.txt')).toBe('ab.txt');
    expect(sanitizeFileName('photo‮gnp.exe')).toBe('photognp.exe');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('x'.repeat(300) + '.png').length).toBeLessThanOrEqual(120);
  });

  it('svg і html віддаються ВКЛАДЕННЯМ, навіть якщо клієнт назвав їх інакше', async () => {
    const { agent, boardId } = await board('EDITOR');
    for (const [name, body, mime] of [
      ['a.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml'],
      ['b.html', '<!doctype html><html><script>alert(1)</script></html>', 'text/html'],
    ] as const) {
      const up = await agent
        .post(`/api/boards/${boardId}/files`)
        .set('Content-Type', 'image/png')
        .set('X-File-Name', name)
        .send(Buffer.from(body, 'utf8'));
      expect(up.status, name).toBe(201);
      expect(up.body.mime, name).toBe(mime);

      const got = await agent.get(`/api/boards/${boardId}/files/${up.body.id}`);
      expect(got.status, name).toBe(200);
      expect(got.headers['content-disposition'], name).toMatch(/^attachment/);
      expect(got.headers['content-type'], name).toMatch(/application\/octet-stream/);
      expect(got.headers['x-content-type-options'], name).toBe('nosniff');
      expect(got.headers['content-security-policy'], name).toContain('sandbox');
    }
  });

  it('картинка віддається inline, але з nosniff', async () => {
    const { agent, boardId } = await board('EDITOR');
    const up = await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'p.png')
      .send(png);
    const got = await agent.get(`/api/boards/${boardId}/files/${up.body.id}`);
    expect(got.headers['content-disposition']).toMatch(/^inline/);
    expect(got.headers['content-type']).toContain('image/png');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
  });

  it('файл чужої дошки — 404, не 403', async () => {
    const mine = await board('EDITOR');
    const up = await mine.agent
      .post(`/api/boards/${mine.boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'p.png')
      .send(png);

    const stranger = await registerUser();
    const theirBoard = await stranger.agent.post('/api/boards').send({ title: 'Інша' });
    // той самий id файла, але через ЧУЖУ дошку
    await stranger.agent
      .get(`/api/boards/${theirBoard.body.id}/files/${up.body.id}`)
      .expect(404);
    // і зовсім сторонній до нашої дошки не дістанеться
    await stranger.agent.get(`/api/boards/${mine.boardId}/files/${up.body.id}`).expect(404);
  });

  it('діапазон байтів для перемотування', async () => {
    const { agent, boardId } = await board('EDITOR');
    const up = await agent
      .post(`/api/boards/${boardId}/files`)
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', 'v.bin')
      .send(png);

    const part = await agent.get(`/api/boards/${boardId}/files/${up.body.id}`).set('Range', 'bytes=0-9');
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-9/${png.length}`);
    expect(part.headers['content-length']).toBe('10');

    const bad = await agent
      .get(`/api/boards/${boardId}/files/${up.body.id}`)
      .set('Range', `bytes=${png.length + 10}-`);
    expect(bad.status).toBe(416);
  });

  it('тип рахується з байтів, а не з назви чи заголовка', () => {
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('просто текст', 'utf8'))).toBe('text/plain');
    expect(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00]))).toBe('application/octet-stream');
  });
});
