import { Router } from 'express';
import type { Request } from 'express';
import type { SaveSnapshotRequest, SnapshotResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { getBoardAccess, requireBoardAccess, requireBoardEditor } from './boards.service';
import { saveSnapshotSchema } from './snapshots.schema';
import {
  countInCells,
  readSnapshot,
  readSnapshotState,
  writeSnapshotCells,
  writeSnapshotState,
} from './snapshots.service';
import { maybeCreateAutoVersion } from './versions.service';

// вміст дошки лежить по клітинках сітки (BoardSnapshotCell) — див.
// snapshots.service. mergeParams — :id живе в префіксі монтування в app.ts
export const snapshotsRouter = Router({ mergeParams: true });

snapshotsRouter.use(requireAuth);

snapshotsRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const snapshot = await readSnapshot(access.board.id);

    // нову дошку ще не зберігали — це не помилка, просто порожньо
    const body: SnapshotResponse = snapshot
      ? { objects: snapshot.objects, updatedAt: snapshot.updatedAt.toISOString() }
      : { objects: [], updatedAt: null };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

snapshotsRouter.put('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardEditor(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = saveSnapshotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректний стан дошки');
    }
    const { objects, cells }: SaveSnapshotRequest = parsed.data;

    // єдине місце, де вміст дошки лягає в базу. Пишемо в журнал кількість
    // обʼєктів і хто пише: саме тут зникали обʼєкти (журнал 20.09)
    if (cells) {
      // стратегія 3: клієнт бачить лише свої клітинки й пише рівно їх. Обʼєкт
      // поза переліченими клітинками від нього не приймаємо: про ту клітинку
      // він не знає правди. Решти дошки не читаємо й не чіпаємо — саме тому
      // двоє, що зберігають різні ділянки, більше не затирають одне одного
      const was = await countInCells(access.board.id, cells);
      await writeSnapshotCells(access.board.id, cells, objects);
      console.info(
        `[boardsync-diag] ${new Date().toISOString()} клітинки збережено`,
        JSON.stringify({
          boardId: access.board.id,
          userId: req.userId,
          клітинок: cells.length,
          було: was,
          стало: objects.length,
        }),
      );
    } else {
      const previous = await readSnapshotState(access.board.id);
      const wasEmpty = previous ? (JSON.parse(previous.toString('utf8')) as unknown[]).length : 0;
      if (objects.length === 0 && wasEmpty > 0) {
        console.warn(
          `[boardsync-diag] ${new Date().toISOString()} УВАГА: порожній знімок поверх непорожнього`,
          JSON.stringify({ boardId: access.board.id, userId: req.userId, було: wasEmpty, стало: 0 }),
        );
      } else {
        console.info(
          `[boardsync-diag] ${new Date().toISOString()} знімок збережено`,
          JSON.stringify({
            boardId: access.board.id,
            userId: req.userId,
            було: wasEmpty,
            стало: objects.length,
          }),
        );
      }
      await writeSnapshotState(access.board.id, Buffer.from(JSON.stringify(objects), 'utf8'));
    }

    // автоверсія живе тут, а не таймером на сервері: знімок приходить лише
    // тоді, коли дошку справді правлять, — на покинутій дошці версії не множаться.
    // стан збираємо ліниво: версія виходить раз на 10 хв, а збереження — раз на
    // 2.5с, і щоразу зшивати всю дошку заради викинутого буфера нема сенсу
    await maybeCreateAutoVersion(
      access.board.id,
      () => readSnapshotState(access.board.id),
      req.userId as string,
      new Date(),
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
