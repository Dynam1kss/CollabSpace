import type { Response } from 'express';
import { Router } from 'express';
import type { AuthResponse, LoginRequest, RegisterRequest } from 'shared';
import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE_MS, authCookieOptions } from '../cookies';
import { env } from '../env';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { authRateLimiter } from './auth.rate-limit';
import { DUMMY_PASSWORD_HASH, hashPassword, signAuthToken, toAuthUser, verifyPassword } from './auth.service';
import { loginSchema, registerSchema } from './auth.schema';
import { requireAuth } from './auth.middleware';

export const authRouter = Router();

function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, {
    ...authCookieOptions(env.isProduction),
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

authRouter.post('/register', authRateLimiter(), async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані реєстрації');
    }
    const { email, password, displayName }: RegisterRequest = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'Користувач з такою поштою вже існує');
    }

    const user = await prisma.user.create({
      data: { email, displayName, passwordHash: await hashPassword(password) },
    });

    setAuthCookie(res, signAuthToken(user.id));
    const body: AuthResponse = { user: toAuthUser(user) };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', authRateLimiter(), async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані входу');
    }
    const { email, password }: LoginRequest = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    // verify виконуємо завжди, навіть для неіснуючої пошти — інакше час відповіді видає її наявність
    const passwordValid = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!user || !passwordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Невірна пошта або пароль');
    }

    setAuthCookie(res, signAuthToken(user.id));
    const body: AuthResponse = { user: toAuthUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Потрібна авторизація');
    }
    const body: AuthResponse = { user: toAuthUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, authCookieOptions(env.isProduction));
  res.status(204).end();
});
