import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import type { VersionsResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { broadcastRestore } from './board-rooms';
import { getBoardAccess, getDisplayName, requireBoardAccess, requireBoardAdmin } from './boards.service';
import { readSnapshotState, writeSnapshotState } from './snapshots.service';
import { createVersion, listVersions, toVersionInfo } from './versions.service';

// історія версій дошки. Дивитись — будь-хто з доступом, зберігати вручну й
// відкочувати — лише власник і адміністратор: відкат переписує роботу всіх
export const versionsRouter = Router({ mergeParams: true });

versionsRouter.use(requireAuth);

const saveVersionSchema = z.object({
  label: z.string().trim().max(80).optional(),
});

versionsRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const body: VersionsResponse = { versions: await listVersions(access.board.id) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

versionsRouter.post('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));
    const parsed = saveVersionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Некоректний підпис версії');
    // вміст беремо з бази, а не з тіла запиту: версія — це те, що справді
    // збережено, а не те, що клієнт каже, що в нього є
    const state = (await readSnapshotState(access.board.id)) ?? Buffer.from('[]', 'utf8');
    const version = await createVersion(access.board.id, state, req.userId as string, {
      label: parsed.data.label || null,
    });
    res.status(201).json(toVersionInfo(version, await getDisplayName(req.userId as string)));
  } catch (err) {
    next(err);
  }
});

versionsRouter.post(
  '/:versionId/restore',
  async (req: Request<{ id: string; versionId: string }>, res, next) => {
    try {
      const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));
      // версія чужої дошки для цієї — те саме, що неіснуюча
      const version = await prisma.boardVersion.findFirst({
        where: { id: req.params.versionId, boardId: access.board.id },
        select: { state: true },
      });
      if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Версію не знайдено');

      // поточний стан — окремою автоверсією перед перезаписом: відкат теж
      // можна зробити помилково, і тоді є куди повернутись
      const current = await readSnapshotState(access.board.id);
      if (current) await createVersion(access.board.id, current, req.userId as string, null);

      await writeSnapshotState(access.board.id, version.state);
      console.info(
        `[boardsync-diag] ${new Date().toISOString()} дошку відкочено до версії`,
        JSON.stringify({ boardId: access.board.id, versionId: req.params.versionId, userId: req.userId }),
      );
      broadcastRestore(access.board.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
