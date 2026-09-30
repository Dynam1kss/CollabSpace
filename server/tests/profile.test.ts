import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BIO_MAX_LENGTH } from 'shared';
import request from 'supertest';
import { app } from '../src/app';
import { UPLOADS_DIR } from '../src/boards/images.routes';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const avatarDirs: string[] = [];

afterEach(async () => {
  await prisma.user.deleteMany();
  for (const id of avatarDirs.splice(0)) {
    await rm(resolve(UPLOADS_DIR, 'avatars', id), { recursive: true, force: true });
  }
});

const fileOf = (url: string) => resolve(UPLOADS_DIR, url.replace(/^\/uploads\//, ''));

describe('профіль: підпис', () => {
  it('зберігає підпис і віддає його в /auth/me', async () => {
    const { agent } = await registerUser();

    const res = await agent.patch('/api/me').send({ bio: 'малюю схеми, люблю каву' });
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe('малюю схеми, люблю каву');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.bio).toBe('малюю схеми, люблю каву');
  });

  it('у нового користувача підпису нема', async () => {
    const { user } = await registerUser();
    expect(user.bio).toBeNull();
  });

  it('порожній рядок прибирає підпис, а не лишає порожнечу', async () => {
    const { agent } = await registerUser();
    await agent.patch('/api/me').send({ bio: 'було' });

    const res = await agent.patch('/api/me').send({ bio: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBeNull();
  });

  it('довший за межу не приймає, старий лишається', async () => {
    const { agent } = await registerUser();
    await agent.patch('/api/me').send({ bio: 'короткий' });

    const res = await agent.patch('/api/me').send({ bio: 'я'.repeat(BIO_MAX_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.bio).toBe('короткий');
  });

  it('рівно на межі приймає', async () => {
    const { agent } = await registerUser();
    const res = await agent.patch('/api/me').send({ bio: 'я'.repeat(BIO_MAX_LENGTH) });
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toHaveLength(BIO_MAX_LENGTH);
  });

  it('зміна лише імені підпис не чіпає', async () => {
    const { agent } = await registerUser();
    await agent.patch('/api/me').send({ bio: 'лишається' });

    const res = await agent.patch('/api/me').send({ displayName: 'Нове' });
    expect(res.body.user.bio).toBe('лишається');
  });
});

describe('профіль: імʼя', () => {
  it('міняє своє імʼя, і /auth/me уже віддає нове', async () => {
    const { agent, user } = await registerUser({ displayName: 'Старе' });

    const res = await agent.patch('/api/me').send({ displayName: 'Нове імʼя' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: user.id,
      displayName: 'Нове імʼя',
      avatarUrl: null,
      theme: 'light',
    });

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.displayName).toBe('Нове імʼя');
  });

  it('ті самі правила, що й на реєстрації: порожнє чи понад 100 — 400, нічого не змінено', async () => {
    const { agent, user } = await registerUser({ displayName: 'Лишаюсь' });

    expect((await agent.patch('/api/me').send({ displayName: '' })).status).toBe(400);
    expect((await agent.patch('/api/me').send({ displayName: 'я'.repeat(101) })).status).toBe(400);
    expect((await agent.patch('/api/me').send({})).status).toBe(400);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row!.displayName).toBe('Лишаюсь');
  });

  it('без куки — 401', async () => {
    expect((await request(app).patch('/api/me').send({ displayName: 'Хтось' })).status).toBe(401);
  });

  it('міняє лише себе — іншого користувача не зачіпає', async () => {
    const a = await registerUser({ displayName: 'Перший' });
    const b = await registerUser({ displayName: 'Другий' });

    await a.agent.patch('/api/me').send({ displayName: 'Перший новий' });
    const other = await prisma.user.findUnique({ where: { id: b.user.id } });
    expect(other!.displayName).toBe('Другий');
  });
});

describe('профіль: аватар', () => {
  it('png — 200, url у профілі, файл лежить і віддається статикою', async () => {
    const { agent, user } = await registerUser();
    avatarDirs.push(user.id);

    const res = await agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toMatch(new RegExp(`^/uploads/avatars/${user.id}/[0-9a-f-]{36}\\.png$`));
    expect(existsSync(fileOf(res.body.user.avatarUrl))).toBe(true);

    const file = await request(app).get(res.body.user.avatarUrl).buffer();
    expect(file.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.avatarUrl).toBe(res.body.user.avatarUrl);
  });

  it('новий аватар замінює старий — і старий файл справді зникає з диска', async () => {
    const { agent, user } = await registerUser();
    avatarDirs.push(user.id);

    const first = await agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);
    const second = await agent.post('/api/me/avatar').set('Content-Type', 'image/jpeg').send(PNG);
    expect(second.status).toBe(200);
    expect(second.body.user.avatarUrl).not.toBe(first.body.user.avatarUrl);
    expect(second.body.user.avatarUrl).toMatch(/\.jpg$/);

    expect(existsSync(fileOf(first.body.user.avatarUrl))).toBe(false);
    expect(existsSync(fileOf(second.body.user.avatarUrl))).toBe(true);
  });

  it('не картинка — 415, порожнє — 400, і аватар не змінився', async () => {
    const { agent, user } = await registerUser();
    avatarDirs.push(user.id);
    const ok = await agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);

    const pdf = await agent
      .post('/api/me/avatar')
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF-1.4'));
    expect(pdf.status).toBe(415);
    const svg = await agent
      .post('/api/me/avatar')
      .set('Content-Type', 'image/svg+xml')
      .send(Buffer.from('<svg/>'));
    expect(svg.status).toBe(415);
    const empty = await agent.post('/api/me/avatar').set('Content-Type', 'image/png').send(Buffer.alloc(0));
    expect(empty.status).toBe(400);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row!.avatarUrl).toBe(ok.body.user.avatarUrl);
    expect(existsSync(fileOf(ok.body.user.avatarUrl))).toBe(true);
  });

  it('понад 5 МБ — 413, аватара як не було, так і нема', async () => {
    const { agent, user } = await registerUser();
    avatarDirs.push(user.id);
    const big = await agent
      .post('/api/me/avatar')
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.avatarUrl).toBeNull();
  });

  it('без куки — 401', async () => {
    const res = await request(app).post('/api/me/avatar').set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(401);
  });
});

describe('профіль: пароль', () => {
  const login = (email: string, password: string) =>
    request(app).post('/api/auth/login').send({ email, password });

  it('правильний поточний — 204, далі входить новий, старий уже ні', async () => {
    const { agent, payload } = await registerUser({ password: 'старий-пароль' });

    const res = await agent
      .post('/api/me/password')
      .send({ currentPassword: 'старий-пароль', newPassword: 'новий-пароль' });
    expect(res.status).toBe(204);

    expect((await login(payload.email, 'новий-пароль')).status).toBe(200);
    expect((await login(payload.email, 'старий-пароль')).status).toBe(401);
    // поточна сесія жива, на вихід не викидає
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('невірний поточний — 401 INVALID_CREDENTIALS, пароль не змінився', async () => {
    const { agent, payload } = await registerUser({ password: 'справжній-пароль' });

    const res = await agent
      .post('/api/me/password')
      .send({ currentPassword: 'не-той-пароль', newPassword: 'новий-пароль' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    expect((await login(payload.email, 'справжній-пароль')).status).toBe(200);
    expect((await login(payload.email, 'новий-пароль')).status).toBe(401);
  });

  it('новий коротший за 8 чи поля бракує — 400, пароль не змінився', async () => {
    const { agent, payload } = await registerUser({ password: 'справжній-пароль' });

    const short = await agent
      .post('/api/me/password')
      .send({ currentPassword: 'справжній-пароль', newPassword: '1234567' });
    expect(short.status).toBe(400);
    expect((await agent.post('/api/me/password').send({ newPassword: 'новий-пароль' })).status).toBe(400);
    expect((await agent.post('/api/me/password').send({ currentPassword: 'справжній-пароль' })).status).toBe(
      400,
    );

    expect((await login(payload.email, 'справжній-пароль')).status).toBe(200);
  });

  it('без куки — 401', async () => {
    const res = await request(app)
      .post('/api/me/password')
      .send({ currentPassword: 'будь-що', newPassword: 'новий-пароль' });
    expect(res.status).toBe(401);
  });
});

describe('профіль: тема', () => {
  it('за замовчуванням світла, dark зберігається і приходить із /auth/me', async () => {
    const { agent, user } = await registerUser({ displayName: 'Тематичний' });
    expect(user.theme).toBe('light');

    const res = await agent.patch('/api/me').send({ theme: 'dark' });
    expect(res.status).toBe(200);
    // імʼя не чіпали — лишилось
    expect(res.body.user).toMatchObject({ theme: 'dark', displayName: 'Тематичний' });
    expect((await agent.get('/api/auth/me')).body.user.theme).toBe('dark');
  });

  it('невідома тема чи порожнє тіло — 400, нічого не змінено', async () => {
    const { agent, user } = await registerUser();
    expect((await agent.patch('/api/me').send({ theme: 'purple' })).status).toBe(400);
    expect((await agent.patch('/api/me').send({})).status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.theme).toBe('light');
  });
});

describe('профіль: мова', () => {
  it('за замовчуванням uk, решта мов зберігаються, тема при цьому не чіпається', async () => {
    const { agent, user } = await registerUser();
    expect(user.locale).toBe('uk');

    await agent.patch('/api/me').send({ theme: 'dark' });
    const en = await agent.patch('/api/me').send({ locale: 'en' });
    expect(en.body.user).toMatchObject({ locale: 'en', theme: 'dark' });
    for (const locale of ['de', 'fr'] as const) {
      expect((await agent.patch('/api/me').send({ locale })).body.user.locale).toBe(locale);
    }
    expect((await agent.get('/api/auth/me')).body.user.locale).toBe('fr');
  });

  it('невідома мова — 400, лишається як була', async () => {
    const { agent, user } = await registerUser();
    expect((await agent.patch('/api/me').send({ locale: 'es' })).status).toBe(400);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.locale).toBe('uk');
  });
});
