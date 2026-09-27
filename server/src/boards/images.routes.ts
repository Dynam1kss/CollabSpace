import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import type { Request } from 'express';
import type { UploadImageResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { getBoardAccess, requireBoardEditor } from './boards.service';

// server/uploads/<boardId>/<uuid>.<ext>; app.ts роздає цю теку як /uploads
export const UPLOADS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads');

// розширення беремо звідси, а не з імені файла на клієнті
export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const imagesRouter = Router({ mergeParams: true });

imagesRouter.use(requireAuth);

// тіло — сирі байти файла, без multipart: один файл за запит, більше не треба.
// raw-парсер лише тут, бо решті api він не потрібен
imagesRouter.post(
  '/',
  express.raw({ type: 'image/*', limit: '5mb' }),
  async (req: Request<{ id: string }>, res, next) => {
    try {
      const access = requireBoardEditor(await getBoardAccess(req.params.id, req.userId as string));

      // content-type може нести ;charset — беремо тільки сам тип
      const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const ext = EXT_BY_MIME[mime];
      if (!ext) {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Підтримуються лише PNG, JPEG, WebP і GIF');
      }
      // якщо тип не пройшов фільтр express.raw, body лишається порожнім обʼєктом
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Порожній файл');
      }

      const dir = resolve(UPLOADS_DIR, access.board.id);
      await mkdir(dir, { recursive: true });
      const name = `${randomUUID()}.${ext}`;
      await writeFile(resolve(dir, name), req.body);

      // відносний шлях — щоб працювало однаково на localhost і через тунель
      const body: UploadImageResponse = { url: `/uploads/${access.board.id}/${name}` };
      res.status(201).json(body);
    } catch (err) {
      next(err);
    }
  },
);
