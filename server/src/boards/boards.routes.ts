import { Router } from 'express';
import { canManageMember } from 'shared';
import type {
  AddBoardMemberRequest,
  BoardDetail,
  BoardListResponse,
  BoardSummary,
  CreateBoardRequest,
  ForceVoiceRequest,
  RemoveBoardMemberRequest,
  UpdateBoardMemberRequest,
  UpdateBoardRequest,
} from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { applyRoleChange, kickMember, setForcedVoice } from './board-rooms';
import { AppError } from '../errors';
import { prisma } from '../prisma';
import {
  addMemberSchema,
  createBoardSchema,
  forceVoiceSchema,
  removeMemberSchema,
  updateBoardSchema,
  updateMemberSchema,
} from './boards.schema';
import type { BoardAccess } from './boards.service';
import {
  getBoardAccess,
  requireBoardAccess,
  requireBoardAdmin,
  requireBoardOwner,
  toBoardDetail,
  toBoardSummary,
} from './boards.service';

export const boardsRouter = Router();

boardsRouter.use(requireAuth);

boardsRouter.get('/', async (req, res, next) => {
  try {
    const boards = await prisma.board.findMany({
      where: {
        OR: [{ ownerId: req.userId }, { members: { some: { userId: req.userId, status: 'ACCEPTED' } } }],
      },
      orderBy: { updatedAt: 'desc' },
      // лише свій рядок участі — щоб знати власну роль на кожній дошці
      include: { members: { where: { userId: req.userId, status: 'ACCEPTED' } } },
    });

    const body: BoardListResponse = {
      boards: boards.map((board) =>
        toBoardSummary(board, req.userId as string, board.members[0]?.role),
      ),
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
    const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));

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
    // ця ручка — upsert, тож для того, хто вже на дошці, вона рівносильна
    // зміні ролі. Без цієї перевірки через неї можна було обійти всю
    // ієрархію: адміністратор «додавав» іншого адміністратора глядачем
    const existing = await prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: access.board.id, userId: user.id } },
      select: { role: true },
    });
    if (existing) await requireCanManage(access, user.id);

    // новий учасник — лише запрошення, доступ зʼявиться, коли він прийме.
    // наявному міняємо тільки роль, статус не чіпаємо

    await prisma.boardMember.upsert({
      where: { boardId_userId: { boardId: access.board.id, userId: user.id } },
      create: { boardId: access.board.id, userId: user.id, role, roleGrantedBy: req.userId, status: 'PENDING' },
      update: { role, roleGrantedBy: req.userId },
    });
    // те саме, що й у patch нижче: відкритий сокет живе з роллю, взятою на
    // підключенні, і без цього лишився б із правами, яких уже немає
    if (existing && existing.role !== role) {
      applyRoleChange(access.board.id, user.id, role, req.userId as string);
    }

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

// кого саме дозволено чіпати: власника — ніколи (у нього й рядка немає, але
// кажемо про це прямо), решту — за canManageMember. Роль і того, хто її дав,
// читаємо з бази саме зараз: усе, що клієнт думає про ієрархію, — підказка
// для кнопок, не більше
async function requireCanManage(access: BoardAccess, targetUserId: string) {
  if (targetUserId === access.board.ownerId) {
    throw new AppError(403, 'FORBIDDEN', 'Власника дошки змінити не можна');
  }
  const target = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId: access.board.id, userId: targetUserId } },
    select: { role: true, roleGrantedBy: true },
  });
  if (!target) {
    throw new AppError(404, 'MEMBER_NOT_FOUND', 'Такого учасника на дошці немає');
  }
  if (!canManageMember(access.role, target, access.board.ownerId)) {
    throw new AppError(403, 'FORBIDDEN', 'Недостатньо прав для цього учасника');
  }
  return target;
}

// роль наявного учасника. Шлях і тіло — як у сусіднього delete нижче
// (userId у тілі, не в шляху), щоб три операції над учасниками виглядали
// однаково. Міняємо рядок на місці: видалити й завести наново означало б
// новий id учасника на кожну зміну ролі
boardsRouter.patch('/:id/members', async (req, res, next) => {
  try {
    const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані учасника');
    }
    const { userId, role }: UpdateBoardMemberRequest = parsed.data;
    await requireCanManage(access, userId);

    await prisma.boardMember.updateMany({
      where: { boardId: access.board.id, userId },
      data: { role, roleGrantedBy: req.userId },
    });
    // відкритий сокет живе з роллю, взятою на підключенні — доганяємо його
    applyRoleChange(access.board.id, userId, role, req.userId as string);

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

// примусове вимкнення мікрофона чи звуку учаснику. Тіло як у сусідніх ручок
// керування учасниками, і та сама ієрархія: власника не чіпає ніхто,
// адміністратор — лише нижчих за себе
boardsRouter.patch('/:id/voice', async (req, res, next) => {
  try {
    const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));
    const parsed = forceVoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані');
    }
    const { userId, mute, deafen }: ForceVoiceRequest = parsed.data;
    await requireCanManage(access, userId);

    setForcedVoice(access.board.id, userId, {
      ...(mute === undefined ? {} : { mute }),
      ...(deafen === undefined ? {} : { deafen }),
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/:id/members', async (req, res, next) => {
  try {
    const access = requireBoardAdmin(await getBoardAccess(req.params.id, req.userId as string));

    const parsed = removeMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Некоректні дані учасника');
    }
    const { userId }: RemoveBoardMemberRequest = parsed.data;
    await requireCanManage(access, userId);

    await prisma.boardMember.deleteMany({ where: { boardId: access.board.id, userId } });
    // доступу вже нема — виводимо з дошки й тих, хто сидить у ній просто зараз
    kickMember(access.board.id, userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
