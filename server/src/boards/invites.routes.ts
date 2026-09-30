import { Router } from 'express';
import type { BoardInvite, InvitesResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { prisma } from '../prisma';

export const invitesRouter = Router();

invitesRouter.use(requireAuth);

invitesRouter.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.boardMember.findMany({
      where: { userId: req.userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { board: { select: { title: true } } },
    });
    // roleGrantedBy — рядок без звʼязку, тому людей дістаємо окремим запитом
    const inviterIds = [
      ...new Set(rows.map((r) => r.roleGrantedBy).filter((id): id is string => id !== null)),
    ];
    const inviters = await prisma.user.findMany({
      where: { id: { in: inviterIds } },
      select: { id: true, displayName: true, email: true, avatarUrl: true, bio: true },
    });
    const byId = new Map(inviters.map((u) => [u.id, u]));

    const invites: BoardInvite[] = rows.map((r) => {
      const inviter = r.roleGrantedBy ? byId.get(r.roleGrantedBy) : undefined;
      return {
        boardId: r.boardId,
        boardTitle: r.board.title,
        role: r.role,
        invitedBy: inviter
          ? {
              userId: inviter.id,
              displayName: inviter.displayName,
              email: inviter.email,
              avatarUrl: inviter.avatarUrl,
              bio: inviter.bio,
            }
          : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
    const body: InvitesResponse = { invites };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// і прийняти, і відхилити можна лише власне PENDING-запрошення. нема такого —
// 404 без пояснень, щоб по відповіді не вгадувати, чи існує дошка
function inviteNotFound() {
  return new AppError(404, 'INVITE_NOT_FOUND', 'Запрошення не знайдено');
}

invitesRouter.post('/:boardId/accept', async (req, res, next) => {
  try {
    const { count } = await prisma.boardMember.updateMany({
      where: { boardId: req.params.boardId, userId: req.userId, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    if (count === 0) throw inviteNotFound();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

invitesRouter.post('/:boardId/decline', async (req, res, next) => {
  try {
    const { count } = await prisma.boardMember.deleteMany({
      where: { boardId: req.params.boardId, userId: req.userId, status: 'PENDING' },
    });
    if (count === 0) throw inviteNotFound();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
