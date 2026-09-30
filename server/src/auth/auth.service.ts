import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from 'argon2';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import type { AuthUser, Locale } from 'shared';
import { LOCALES } from 'shared';
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

// токени з листів: 32 випадкових байти в url-безпечному вигляді. У базі
// лежить лише sha256 від них — див. коментар до моделі PasswordReset
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
// доба, а не година: відновлення пароля людина просить і робить одразу, а лист
// підтвердження часто відкривають потім — увечері, з іншого пристрою
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createEmailToken() {
  return randomBytes(32).toString('base64url');
}

export function hashEmailToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    // у базі рядок; щось стороннє туди потрапити не може, але тип треба звузити
    theme: user.theme === 'dark' ? 'dark' : 'light',
    emailVerified: user.emailVerifiedAt !== null,
    locale: LOCALES.includes(user.locale as Locale) ? (user.locale as Locale) : 'uk',
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };
}
