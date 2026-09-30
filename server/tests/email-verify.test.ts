import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { VERIFY_TOKEN_TTL_MS } from '../src/auth/auth.service';
import { sentMails } from '../src/auth/mailer';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

beforeEach(() => {
  sentMails.length = 0;
});

afterEach(async () => {
  await prisma.user.deleteMany();
});

const verifyMails = () => sentMails.filter((m) => m.text.includes('/verify-email?token='));

function tokenFromMail() {
  const link = verifyMails()
    .at(-1)
    ?.text.match(/verify-email\?token=([\w-]+)/);
  return link?.[1] ?? '';
}

const verify = (token: string) => request(app).post('/api/auth/verify-email').send({ token });

describe('реєстрація', () => {
  it('заводить акаунт непідтвердженим і шле лист', async () => {
    const { user, payload } = await registerUser({ email: 'fresh@test.local' });

    expect(user.emailVerified).toBe(false);
    expect(verifyMails()).toHaveLength(1);
    expect(verifyMails()[0].to).toBe(payload.email);
    expect(tokenFromMail().length).toBeGreaterThan(20);
  });

  it('у базі лежить хеш, а не сам токен', async () => {
    await registerUser();
    const row = await prisma.emailVerification.findFirst();
    expect(row?.tokenHash).not.toBe(tokenFromMail());
    expect(row?.tokenHash).toMatch(/^[\da-f]{64}$/);
  });

  it('непідтверджений акаунт має повний доступ: дошки створюються', async () => {
    const { agent } = await registerUser();
    const res = await agent.post('/api/boards').send({ title: 'До підтвердження' });
    expect(res.status).toBe(201);
    expect((await agent.get('/api/boards')).body.boards).toHaveLength(1);
  });
});

describe('POST /api/auth/verify-email', () => {
  it('підтверджує пошту, і /auth/me віддає прапорець', async () => {
    const { agent } = await registerUser({ email: 'ok@test.local' });

    expect((await verify(tokenFromMail())).status).toBe(204);

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.emailVerified).toBe(true);
    const user = await prisma.user.findUnique({ where: { email: 'ok@test.local' } });
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it('удруге той самий токен не спрацьовує', async () => {
    await registerUser();
    const token = tokenFromMail();
    await verify(token);

    const res = await verify(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFY_TOKEN_INVALID');
  });

  it('прострочений токен відхиляє, пошта лишається непідтвердженою', async () => {
    const { agent } = await registerUser();
    const token = tokenFromMail();
    await prisma.emailVerification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await verify(token);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFY_TOKEN_INVALID');
    expect((await agent.get('/api/auth/me')).body.user.emailVerified).toBe(false);
  });

  it('вигаданий токен відхиляє', async () => {
    const res = await verify('made-up-token');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VERIFY_TOKEN_INVALID');
  });

  it('живе добу', async () => {
    await registerUser();
    const row = await prisma.emailVerification.findFirst();
    const hours = Math.round((row!.expiresAt.getTime() - row!.createdAt.getTime()) / 3_600_000);
    expect(hours).toBe(24);
    expect(VERIFY_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('шле новий лист і гасить попереднє посилання', async () => {
    const { agent } = await registerUser();
    const first = tokenFromMail();

    expect((await agent.post('/api/auth/resend-verification')).status).toBe(204);
    expect(verifyMails()).toHaveLength(2);
    const second = tokenFromMail();
    expect(second).not.toBe(first);

    expect((await verify(first)).status).toBe(400);
    expect((await verify(second)).status).toBe(204);
    expect(await prisma.emailVerification.count()).toBe(1);
  });

  it('без авторизації — 401', async () => {
    const res = await request(app).post('/api/auth/resend-verification');
    expect(res.status).toBe(401);
  });

  it('підтвердженому нічого не шле, але й не помиляється', async () => {
    const { agent } = await registerUser();
    await verify(tokenFromMail());
    sentMails.length = 0;

    const res = await agent.post('/api/auth/resend-verification');
    expect(res.status).toBe(204);
    expect(verifyMails()).toHaveLength(0);
  });
});
