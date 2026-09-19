import { Router } from 'express';
import type {
  AddBoardMemberRequest,
  BoardDetail,
  BoardListResponse,
  BoardSummary,
  CreateBoardRequest,
  RemoveBoardMemberRequest,
  UpdateBoardMemberRequest,
  UpdateBoardRequest,
} from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import {
  addMemberSchema,
  createBoardSchema,
  removeMemberSchema,
  updateBoardSchema,
  updateMemberSchema,
} from './boards.schema';
import {
  getBoardAccess,
  requireBoardAccess,
  requireBoardOwner,
  toBoardDetail,
  toBoardSummary,
} from './boards.service';

export const boardsRouter = Router();

boardsRouter.use(requireAuth);

boardsRouter.get('/', async (req, res, next) => {
  try {
    const boards = await prisma.board.findMany({
      where: { OR: [{ ownerId: req.userId }, { members: { some: { userId: req.userId } } }] },
      orderBy: { updatedAt: 'desc' },
    });

    const body: BoardListResponse = {
      boards: boards.map((board) => toBoardSummary(board, req.userId as string)),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createBoardSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректна назва дошки');
    }
    const { title }: CreateBoardRequest = parsed.data;

    const board = await prisma.board.create({ data: { title, ownerId: req.userId as string } });

    const body: BoardSummary = toBoardSummary(board, req.userId as string);
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

boardsRouter.get('/:id', async (req, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));

    const members = await prisma.boardMember.findMany({
      where: { boardId: access.board.id },
      include: { user: true },
    });

    const body: BoardDetail = toBoardDetail(access.board, members, req.userId as string);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

boardsRouter.patch('/:id', async (req, res, next) => {
  try {
    const access = requireBoardOwner(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = updateBoardSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректна назва дошки');
    }
    const { title }: UpdateBoardRequest = parsed.data;

    const board = await prisma.board.update({ where: { id: access.board.id }, data: { title } });

    const body: BoardSummary = toBoardSummary(board, req.userId as string);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/:id', async (req, res, next) => {
  try {
    const access = requireBoardOwner(await getBoardAccess(req.params.id, req.userId as string));

    await prisma.board.delete({ where: { id: access.board.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/:id/members', async (req, res, next) => {
  try {
    const access = requireBoardOwner(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані учасника');
    }
    const { email, role }: AddBoardMemberRequest = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Користувача з такою поштою не знайдено');
    }
    if (user.id === access.board.ownerId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Власник дошки й так має до неї повний доступ');
    }

    await prisma.boardMember.upsert({
      where: { boardId_userId: { boardId: access.board.id, userId: user.id } },
      create: { boardId: access.board.id, userId: user.id, role },
      update: { role },
    });

    const members = await prisma.boardMember.findMany({
      where: { boardId: access.board.id },
      include: { user: true },
    });

    const body: BoardDetail = toBoardDetail(access.board, members, req.userId as string);
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

// роль наявного учасника. Шлях і тіло — як у сусіднього delete нижче
// (userId у тілі, не в шляху), щоб три операції над учасниками виглядали
// однаково. Міняємо рядок на місці: видалити й завести наново означало б
// новий id учасника на кожну зміну ролі
boardsRouter.patch('/:id/members', async (req, res, next) => {
  try {
    const access = requireBoardOwner(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані учасника');
    }
    const { userId, role }: UpdateBoardMemberRequest = parsed.data;

    // власник у списку учасників не значиться, тому окремої перевірки на
    // нього не треба: рядка просто нема, і це той самий 404
    const changed = await prisma.boardMember.updateMany({
      where: { boardId: access.board.id, userId },
      data: { role },
    });
    if (changed.count === 0) {
      throw new AppError(404, 'MEMBER_NOT_FOUND', 'Такого учасника на дошці немає');
    }

    const members = await prisma.boardMember.findMany({
      where: { boardId: access.board.id },
      include: { user: true },
    });

    const body: BoardDetail = toBoardDetail(access.board, members, req.userId as string);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/:id/members', async (req, res, next) => {
  try {
    const access = requireBoardOwner(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = removeMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані учасника');
    }
    const { userId }: RemoveBoardMemberRequest = parsed.data;

    await prisma.boardMember.deleteMany({ where: { boardId: access.board.id, userId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
