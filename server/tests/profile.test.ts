import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import { registerUser } from './helpers';

afterEach(async () => {
  await prisma.user.deleteMany();
});

describe('профіль: імʼя', () => {
  it('міняє своє імʼя, і /auth/me уже віддає нове', async () => {
    const { agent, user } = await registerUser({ displayName: 'Старе' });

    const res = await agent.patch('/api/me').send({ displayName: 'Нове імʼя' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, displayName: 'Нове імʼя', avatarUrl: null });

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
