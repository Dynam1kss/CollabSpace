import { Router } from 'express';
import type { Request } from 'express';
import type { SaveSeatRequest, SeatResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import { getBoardAccess, requireBoardAccess } from './boards.service';
import { saveSeatSchema } from './seats.schema';

// своє місце на дошці. Читає й пише кожен сам собі — чуже місце тут не
// чіпають; за роллю не гейтимо, бо стілець не є вмістом дошки (як і голос,
// до якого він і прив'язаний). Чужі місця приходять живим кадром SEAT
export const seatsRouter = Router({ mergeParams: true });

seatsRouter.use(requireAuth);

seatsRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const seat = await prisma.boardSeat.findUnique({
      where: { boardId_userId: { boardId: access.board.id, userId: req.userId as string } },
      select: { x: true, y: true },
    });
    const body: SeatResponse = { seat };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

seatsRouter.put('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const parsed = saveSeatSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректне місце на дошці');
    }
    const { x, y }: SaveSeatRequest = parsed.data;

    await prisma.boardSeat.upsert({
      where: { boardId_userId: { boardId: access.board.id, userId: req.userId as string } },
      create: { boardId: access.board.id, userId: req.userId as string, x, y },
      update: { x, y },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
