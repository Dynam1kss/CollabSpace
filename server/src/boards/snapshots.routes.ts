import { Router } from 'express';
import type { Request } from 'express';
import type { BoardObject, SaveSnapshotRequest, SnapshotResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { getBoardAccess, requireBoardAccess, requireBoardEditor } from './boards.service';
import { saveSnapshotSchema } from './snapshots.schema';

// стан дошки одним JSON у BoardSnapshot.state (Bytes) — тимчасово, поки
// нема CRDT; коли прийде Yjs, у те саме поле ляже його бінарний update.
// mergeParams — :id живе в префіксі монтування в app.ts
export const snapshotsRouter = Router({ mergeParams: true });

snapshotsRouter.use(requireAuth);

snapshotsRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const snapshot = await prisma.boardSnapshot.findUnique({ where: { boardId: access.board.id } });

    // нову дошку ще не зберігали — це не помилка, просто порожньо
    const body: SnapshotResponse = snapshot
      ? {
          objects: JSON.parse(snapshot.state.toString('utf8')) as BoardObject[],
          updatedAt: snapshot.updatedAt.toISOString(),
        }
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
    const { objects }: SaveSnapshotRequest = parsed.data;

    // єдине місце, де вміст дошки лягає в базу. Пишемо в журнал кількість
    // обʼєктів і хто пише: саме тут зникали обʼєкти (журнал 20.09)
    const previous = await prisma.boardSnapshot.findUnique({
      where: { boardId: access.board.id },
      select: { state: true },
    });
    const wasEmpty = previous ? (JSON.parse(previous.state.toString('utf8')) as unknown[]).length : 0;
    if (objects.length === 0 && wasEmpty > 0) {
      console.warn(
        `[boardsync-diag] ${new Date().toISOString()} УВАГА: порожній знімок поверх непорожнього`,
        JSON.stringify({ boardId: access.board.id, userId: req.userId, було: wasEmpty, стало: 0 }),
      );
    } else {
      console.info(
        `[boardsync-diag] ${new Date().toISOString()} знімок збережено`,
        JSON.stringify({ boardId: access.board.id, userId: req.userId, було: wasEmpty, стало: objects.length }),
      );
    }

    const state = Buffer.from(JSON.stringify(objects), 'utf8');
    await prisma.boardSnapshot.upsert({
      where: { boardId: access.board.id },
      create: { boardId: access.board.id, state },
      update: { state },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
