import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open as openFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { FILE_ERROR, fileKind, isInlineMime, sanitizeFileName } from 'shared';
import type { ApiErrorBody, BoardFileInfo, BoardFilesUsage } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { env } from '../env';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { getBoardAccess, requireBoardAccess, requireBoardEditor } from './boards.service';
import { boardQuotaUsage, lockBoardQuota } from './file-quota';
import { sniffMime } from './file-sniff';
import { UPLOADS_DIR } from './images.routes';

export const filesRouter = Router({ mergeParams: true });

// файли лежать окремо від картинок дошки: у них інший життєвий цикл (прибирач
// сиріт) і інша віддача (лише під авторизацією)
export const FILES_DIR = resolve(UPLOADS_DIR, '..', 'files');

filesRouter.use(requireAuth);

// завантаження — важка операція з записом на диск; обмежуємо саме її, і саме
// на людину. Читання файлів під ліміт не підпадає
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? 'anon',
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, res) => {
    const body: ApiErrorBody = {
      error: { code: FILE_ERROR.rate, message: 'Забагато завантажень, спробуйте пізніше' },
    };
    res.status(429).json(body);
  },
});

function tooLarge() {
  return new AppError(413, FILE_ERROR.tooLarge, 'Файл перевищує дозволений розмір');
}

function quotaFull(usedBytes: number, totalBytes: number) {
  return new AppError(413, FILE_ERROR.quota, 'На дошці закінчилося місце для файлів', {
    usedBytes,
    totalBytes,
  });
}

// скільки місця зайнято — для підказки на кнопці файлів
filesRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const usage = await boardQuotaUsage(access.board.id);
    const body: BoardFilesUsage = {
      usedBytes: usage.usedBytes,
      storedBytes: usage.storedBytes,
      quotaBytes: usage.quotaBytes,
      fileMaxBytes: env.fileMaxBytes,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// сире тіло запиту — без жодної нової залежності. Назва файла їде в заголовку
// (відсоткове кодування, бо в заголовок можна класти лише ascii), а саме тіло
// ллється на диск потоком: тримати 50мб у памʼяті на кожне завантаження
// означало б покласти сервер кількома вкладками
filesRouter.post('/', uploadLimiter, async (req: Request<{ id: string }>, res, next) => {
  let target: string | null = null;
  try {
    const access = requireBoardEditor(await getBoardAccess(req.params.id, req.userId as string));
    const boardId = access.board.id;

    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > env.fileMaxBytes) throw tooLarge();
    // груба передперевірка, щоб не писати на диск завідомо зайве; остаточна —
    // нижче, під блокуванням
    const before = await boardQuotaUsage(boardId);
    if (declared > 0 && before.usedBytes + declared > before.quotaBytes) {
      throw quotaFull(before.usedBytes, before.quotaBytes);
    }

    const rawName = req.headers['x-file-name'];
    const name = sanitizeFileName(decodeURIComponent(typeof rawName === 'string' ? rawName : ''));

    await mkdir(FILES_DIR, { recursive: true });
    const storageName = randomUUID();
    target = resolve(FILES_DIR, storageName);

    // Content-Length міг і збрехати, і бути відсутнім — тому рахуємо байти
    // по дорозі й рвемо потік, щойно межу перейдено
    let size = 0;
    let head: Buffer = Buffer.alloc(0);
    let overflow: AppError | null = null;
    const out = createWriteStream(target);
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (head.length < 1024) head = Buffer.concat([head, chunk.subarray(0, 1024 - head.length)]);
      if (size > env.fileMaxBytes) {
        overflow = tooLarge();
        req.destroy();
      } else if (before.usedBytes + size > before.quotaBytes) {
        overflow = quotaFull(before.usedBytes, before.quotaBytes);
        req.destroy();
      }
    });

    try {
      await pipeline(req, out);
    } catch (err) {
      // обрив через нашу ж межу — це 413, а не «щось пішло не так»
      if (overflow) throw overflow;
      throw err;
    }
    if (overflow) throw overflow as AppError;
    if (size === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Порожній файл');

    const mime = sniffMime(head);
    // остаточна перевірка — в одній транзакції з блокуванням саме цієї дошки:
    // без нього двоє одночасних завантажень обидва проходять перевірку й
    // разом перебирають межу
    const created = await prisma.$transaction(async (tx) => {
      await lockBoardQuota(tx, boardId);
      const usage = await boardQuotaUsage(boardId, tx);
      if (usage.usedBytes + size > usage.quotaBytes) throw quotaFull(usage.usedBytes, usage.quotaBytes);
      // стеля на все збережене, разом із покинутим: інакше цикл
      // «завантажив — видалив» ріс би на диску нескінченно
      if (usage.storedBytes + size > usage.storedCapBytes) {
        throw quotaFull(usage.usedBytes, usage.quotaBytes);
      }
      const row = await tx.boardFile.create({
        data: { boardId, uploaderId: req.userId as string, name, mime, size, storageName },
      });
      return { row, usedBytes: usage.usedBytes + size };
    });
    target = null;

    const body: BoardFileInfo = {
      id: created.row.id,
      name: created.row.name,
      mime: created.row.mime,
      size: created.row.size,
      boardUsedBytes: created.usedBytes,
    };
    res.status(201).json(body);
  } catch (err) {
    // недописаний файл на диску не лишаємо ніколи
    if (target) await unlink(target).catch(() => {});
    next(err);
  }
});

// віддача — лише учасникам дошки. Це НЕ express.static: статика роздає все
// всім, хто вгадав шлях, а файли дошки мусять жити за тими самими правилами,
// що й сама дошка
filesRouter.get('/:fileId', async (req: Request<{ id: string; fileId: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    // файл іншої дошки — саме 404, а не 403: інакше по відповіді можна було б
    // перебирати, які id існують
    const file = await prisma.boardFile.findFirst({
      where: { id: req.params.fileId, boardId: access.board.id },
    });
    if (!file) throw new AppError(404, 'NOT_FOUND', 'Файл не знайдено');

    // імʼя на диску ми згенерували самі (uuid) — у шлях іде лише воно, тож
    // вийти з теки назвою від користувача неможливо
    const path = resolve(FILES_DIR, file.storageName);
    if (!path.startsWith(resolve(FILES_DIR))) throw new AppError(404, 'NOT_FOUND', 'Файл не знайдено');
    const info = await stat(path).catch(() => null);
    if (!info) throw new AppError(404, 'NOT_FOUND', 'Файл не знайдено');

    sendFile(req, res, path, info.size, file.name, file.mime);
  } catch (err) {
    next(err);
  }
});

// латиниця для старих клієнтів плюс filename* з повною назвою — так роблять
// усі; у латинській версії лишаємо тільки те, що точно не зламає заголовок
function contentDisposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendFile(req: Request, res: Response, path: string, size: number, name: string, mime: string) {
  const inline = isInlineMime(mime);
  res.setHeader('Content-Type', inline ? mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(name, inline));
  // браузер не має права передумати щодо типу: саме на цьому тримається вся
  // безпека віддачі
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // навіть якщо щось пройде повз білий список, виконати воно нічого не зможе.
  // sandbox без allow-scripts; pdf.js у браузері від цього не ламається, бо
  // це вбудований переглядач, а не вміст сторінки
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'");
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Accept-Ranges', 'bytes');

  // діапазони потрібні, щоб відео й звук можна було перемотувати
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] !== '' || range[2] !== '')) {
    const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (start >= size || start > end) {
      res.setHeader('Content-Range', `bytes */${size}`);
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    createReadStream(path, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', String(size));
  createReadStream(path).pipe(res);
}

// невеликий текст для попереднього перегляду: читаємо рівно стільки, скільки
// покажемо, і віддаємо як текст — ніколи як html
export async function readTextHead(path: string, maxBytes: number) {
  const handle = await openFile(path, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export { fileKind };
