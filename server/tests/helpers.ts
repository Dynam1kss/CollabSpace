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

type Agent = ReturnType<typeof request.agent>;

// запрошення тепер чекає згоди. там, де тест про права, а не про самі
// запрошення, кличемо й одразу приймаємо. відповідь — від самого запрошення
export async function addMember(
  inviter: { agent: Agent },
  boardId: string,
  invitee: { agent: Agent; email?: string; payload?: { email: string } },
  role: string,
) {
  const email = invitee.payload?.email ?? invitee.email;
  const res = await inviter.agent.post(`/api/boards/${boardId}/members`).send({ email, role });
  if (res.status === 201) await invitee.agent.post(`/api/invites/${boardId}/accept`);
  return res;
}
