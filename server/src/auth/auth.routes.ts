import type { Response } from 'express';
import { Router } from 'express';
import type {
  AuthResponse,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
} from 'shared';
import { AUTH_COOKIE, AUTH_COOKIE_MAX_AGE_MS, authCookieOptions } from '../cookies';
import { env } from '../env';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { authRateLimiter } from './auth.rate-limit';
import { sendMail } from './mailer';
import {
  createResetToken,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
  signAuthToken,
  toAuthUser,
  verifyPassword,
} from './auth.service';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from './auth.schema';
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

// 204 і на існуючу пошту, і на будь-яку іншу. Ліміт той самий, що на вході:
// без нього цією ручкою можна було б і забивати чужу скриньку, і перебирати
// пошти за часом відповіді
authRouter.post('/forgot-password', authRateLimiter(), async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректна пошта');
    }
    const { email }: ForgotPasswordRequest = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = createResetToken();
      // старі невикористані прибираємо: два листи підряд — дійсний лише
      // останній, інакше посилання з першого лишалось би живим ще годину
      await prisma.passwordReset.deleteMany({ where: { userId: user.id, usedAt: null } });
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hashResetToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const link = `${env.appUrl}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: 'CollabSpace: відновлення пароля',
        text: `Щоб задати новий пароль, відкрийте посилання:
${link}

Воно дійсне ${RESET_TOKEN_TTL_MS / 60000} хвилин і спрацює один раз. Якщо пароль ви не забували — лист можна просто викинути.`,
      });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// прострочений, використаний і вигаданий токен — одна відповідь на всіх:
// розрізняти їх для того, хто прийшов із чужим посиланням, нема сенсу
authRouter.post('/reset-password', authRateLimiter(), async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Пароль має бути щонайменше 8 символів');
    }
    const { token, password }: ResetPasswordRequest = parsed.data;

    const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      throw new AppError(400, 'RESET_TOKEN_INVALID', 'Посилання недійсне або вже використане');
    }

    // спершу гасимо токен умовним апдейтом, і лише потім міняємо пароль:
    // два запити з одним посиланням одночасно інакше обидва пройшли б перевірку
    const claimed = await prisma.passwordReset.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new AppError(400, 'RESET_TOKEN_INVALID', 'Посилання недійсне або вже використане');
    }
    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    res.status(204).end();
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
