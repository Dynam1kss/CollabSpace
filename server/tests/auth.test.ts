import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe('POST /api/auth/register', () => {
  it('реєструє нового користувача і виставляє кукі авторизації', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@test.local', password: 'password123', displayName: 'Новий Юзер' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@test.local');
    expect(res.headers['set-cookie']?.[0]).toMatch(/^token=/);
  });

  it('відхиляє реєстрацію з поштою, що вже зайнята', async () => {
    await registerUser({ email: 'dup@test.local' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@test.local', password: 'password123', displayName: 'Другий' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('POST /api/auth/login', () => {
  it('відхиляє вхід з невірним паролем', async () => {
    const { payload } = await registerUser({ email: 'login@test.local', password: 'correct-password' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/auth/me', () => {
  it('відмовляє в доступі без кукі', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('повертає користувача після входу', async () => {
    const { agent, payload } = await registerUser({ email: 'me@test.local' });

    const res = await agent.get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(payload.email);
  });
});
