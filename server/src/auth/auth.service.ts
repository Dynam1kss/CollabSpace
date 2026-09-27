import { hash, verify } from 'argon2';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import type { AuthUser } from 'shared';
import { env } from '../env';

export function hashPassword(password: string) {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string) {
  return verify(passwordHash, password);
}

// фіктивний хеш для юзера, якого не існує — щоб verify виконувався завжди
// і час відповіді логіна не видавав, чи є така пошта в базі
export const DUMMY_PASSWORD_HASH = await hash('dummy-password-for-constant-time-login');

export function signAuthToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    if (typeof payload === 'object' && payload !== null && typeof payload.sub === 'string') {
      return payload.sub;
    }
    return null;
  } catch {
    return null;
  }
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}
