import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { sentMails } from '../src/auth/mailer';
import { RESET_TOKEN_TTL_MS } from '../src/auth/auth.service';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

beforeEach(() => {
  sentMails.length = 0;
});

afterEach(async () => {
  await prisma.user.deleteMany();
});

// посилання з листа — єдине місце, де токен видно у відкритому вигляді:
// у базі лежить лише його хеш
function tokenFromMail() {
  const link = sentMails.at(-1)?.text.match(/token=([\w-]+)/);
  return link?.[1] ?? '';
}

describe('POST /api/auth/forgot-password', () => {
  it('шле лист із посиланням на існуючу пошту', async () => {
    const { payload } = await registerUser({ email: 'forgot@test.local' });

    const res = await request(app).post('/api/auth/forgot-password').send({ email: payload.email });

    expect(res.status).toBe(204);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].to).toBe(payload.email);
    expect(tokenFromMail().length).toBeGreaterThan(20);
  });

  it('на неіснуючу пошту відповідає так само, але листа не шле', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' });

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(sentMails).toHaveLength(0);
  });

  it('у базі лежить хеш, а не сам токен', async () => {
    await registerUser({ email: 'hashed@test.local' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'hashed@test.local' });

    const row = await prisma.passwordReset.findFirst();
    expect(row?.tokenHash).not.toBe(tokenFromMail());
    expect(row?.tokenHash).toMatch(/^[\da-f]{64}$/);
  });

  it('другий лист гасить посилання з першого', async () => {
    await registerUser({ email: 'twice@test.local' });
    await request(app).post('/api/auth/forgot-password').send({ email: 'twice@test.local' });
    const first = tokenFromMail();
    await request(app).post('/api/auth/forgot-password').send({ email: 'twice@test.local' });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: first, password: 'new-password-1' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
    expect(await prisma.passwordReset.count()).toBe(1);
  });
});

describe('POST /api/auth/reset-password', () => {
  async function requestReset(email: string) {
    await registerUser({ email, password: 'old-password' });
    await request(app).post('/api/auth/forgot-password').send({ email });
    return tokenFromMail();
  }

  it('змінює пароль, і новим уже можна увійти', async () => {
    const token = await requestReset('reset@test.local');

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'brand-new-password' });
    expect(res.status).toBe(204);

    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@test.local', password: 'brand-new-password' });
    expect(ok.status).toBe(200);

    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset@test.local', password: 'old-password' });
    expect(old.status).toBe(401);
  });

  it('удруге той самий токен не спрацьовує', async () => {
    const token = await requestReset('once@test.local');
    await request(app).post('/api/auth/reset-password').send({ token, password: 'first-new-pass' });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'second-new-pass' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('живе годину: через 50 хв ще працює, через 61 — вже ні', async () => {
    const token = await requestReset('ttl@test.local');
    const row = await prisma.passwordReset.findFirst();
    // сам термін у базі — рівно година від видачі
    const ttlMinutes = Math.round((row!.expiresAt.getTime() - row!.createdAt.getTime()) / 60_000);
    expect(ttlMinutes).toBe(60);

    // відсуваємо видачу на 50 хв назад — токен ще дійсний
    await prisma.passwordReset.updateMany({
      data: { expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS - 50 * 60_000) },
    });
    const ok = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'fifty-minutes-later' });
    expect(ok.status).toBe(204);

    // а через 61 хв від видачі — вже ні
    const second = await requestReset('ttl2@test.local');
    await prisma.passwordReset.updateMany({
      where: { usedAt: null },
      data: { expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS - 61 * 60_000) },
    });
    const late = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: second, password: 'sixty-one-later' });
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('прострочений токен відхиляє', async () => {
    const token = await requestReset('expired@test.local');
    await prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'too-late-password' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('вигаданий токен відхиляє', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'made-up-token', password: 'whatever-password' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('короткий пароль не приймає, токен лишається дійсним', async () => {
    const token = await requestReset('short@test.local');

    const bad = await request(app).post('/api/auth/reset-password').send({ token, password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const ok = await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'long-enough-password' });
    expect(ok.status).toBe(204);
  });
});
