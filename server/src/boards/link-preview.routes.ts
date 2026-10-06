import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isLinkUrl } from 'shared';
import type { ApiErrorBody, LinkPreviewRequest, LinkPreviewResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { getBoardAccess, requireBoardEditor } from './boards.service';
import { BlockedUrlError, buildPreview, isCachedFresh } from './link-preview.service';

export const linkPreviewRouter = Router();

linkPreviewRouter.use(requireAuth);

// ліміт саме на людину, а не на адресу: ручка ходить у зовнішню мережу, і
// крутити нею має сенс лише зрідка — на створення картки й на «оновити»
linkPreviewRouter.use(
  rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.userId ?? 'anon',
    // готове прев'ю слот не витрачає: інакше дошка з трьома десятками
    // посилань вичерпувала б ліміт самим лише відкриттям
    skip: (req) => {
      if (process.env.NODE_ENV === 'test') return true;
      const url = (req.body as { url?: unknown } | undefined)?.url;
      return typeof url === 'string' && isCachedFresh(url);
    },
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'TOO_MANY_REQUESTS', message: 'Забагато запитів прев’ю, спробуйте пізніше' },
      };
      res.status(429).json(body);
    },
  }),
);

linkPreviewRouter.post('/', async (req, res, next) => {
  try {
    const { boardId, url } = (req.body ?? {}) as Partial<LinkPreviewRequest>;
    if (typeof boardId !== 'string' || typeof url !== 'string' || !isLinkUrl(url)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Потрібні boardId і коректна адреса');
    }
    // прев'ю тягне той, хто й так може створити обʼєкт: глядачеві ця ручка
    // дала б змогу ганяти сервер у мережу, нічого при цьому не редагуючи
    requireBoardEditor(await getBoardAccess(boardId, req.userId as string));

    const preview = await buildPreview(url);
    const body: LinkPreviewResponse = preview;
    res.json(body);
  } catch (err) {
    if (err instanceof BlockedUrlError) {
      // не кажемо, ЧОМУ саме відмовили: інакше ручка стає сканером мережі
      next(new AppError(422, 'PREVIEW_UNAVAILABLE', 'Не вдалося отримати прев’ю'));
      return;
    }
    next(err);
  }
});
