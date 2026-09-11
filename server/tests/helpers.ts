import request from 'supertest';
import type { AuthUser } from 'shared';
import { app } from '../src/app';

let counter = 0;

export async function registerUser(
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
) {
  counter += 1;
  const payload = {
    email: overrides.email ?? `user${counter}@test.local`,
    password: overrides.password ?? 'password123',
    displayName: overrides.displayName ?? `Тестовий Юзер ${counter}`,
  };

  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send(payload);
  return { agent, user: res.body.user as AuthUser, payload };
}
