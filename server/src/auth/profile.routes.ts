import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import express, { Router } from 'express';
import type { AuthResponse, ChangePasswordRequest, UpdateProfileRequest } from 'shared';
import { EXT_BY_MIME, UPLOADS_DIR } from '../boards/images.routes';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { requireAuth } from './auth.middleware';
import { authRateLimiter } from './auth.rate-limit';
import { changePasswordSchema, updateProfileSchema } from './auth.schema';
import { hashPassword, toAuthUser, verifyPassword } from './auth.service';

// власний профіль: кожна ручка міняє лише того, хто прийшов із кукою
export const profileRouter = Router();

profileRouter.use(requireAuth);

profileRouter.patch('/', async (req, res, next) => {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Імʼя має бути від 1 до 100 символів');
    }
    const { displayName }: UpdateProfileRequest = parsed.data;

    const user = await prisma.user.update({ where: { id: req.userId }, data: { displayName } });
    const body: AuthResponse = { user: toAuthUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// те саме, що з картинками на дошці: сирі байти, тип із content-type.
// uploads/avatars/<userId>/<uuid>.<ext> — нове імʼя щоразу, щоб браузер не
// тримав у кеші старе фото під тим самим url
profileRouter.post('/avatar', express.raw({ type: 'image/*', limit: '5mb' }), async (req, res, next) => {
  try {
    const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
    const ext = EXT_BY_MIME[mime];
    if (!ext) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Підтримуються лише PNG, JPEG, WebP і GIF');
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Порожній файл');
    }

    const userId = req.userId as string;
    const dir = resolve(UPLOADS_DIR, 'avatars', userId);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(resolve(dir, name), req.body);

    const before = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    const user = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: `/uploads/avatars/${userId}/${name}` },
    });

    // старий файл прибираємо, але якщо не вийшло — новий аватар уже стоїть.
    // basename — щоб url із бази не вивів за межі своєї теки
    if (before?.avatarUrl?.startsWith(`/uploads/avatars/${userId}/`)) {
      await unlink(resolve(dir, basename(before.avatarUrl))).catch(() => {});
    }

    const body: AuthResponse = { user: toAuthUser(user) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// інші сесії не розлогінюємо — кука живе своїм терміном, це поза цим кроком.
// ліміт той самий, що на вході: інакше тут можна перебирати чужий пароль
// з відкритої сесії
profileRouter.post('/password', authRateLimiter(), async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Новий пароль має бути щонайменше 8 символів');
    }
    const { currentPassword, newPassword }: ChangePasswordRequest = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Потрібна авторизація');
    }
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Поточний пароль невірний');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
