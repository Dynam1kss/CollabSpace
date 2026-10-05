import type { Board, BoardMember, BoardRole, User } from '@prisma/client';
import { MEMBER_ERROR } from 'shared';
import type { BoardDetail, BoardMemberInfo, BoardSummary } from 'shared';
import { AppError } from '../errors';
import { prisma } from '../prisma';

export interface BoardAccess {
  board: Board;
  role: 'OWNER' | BoardRole;
  // у власника ролі ніхто не давав — тому null
  roleGrantedBy: string | null;
  // відколи людина на цій дошці: рядок учасника, а у власника — сама дошка
  memberSince: Date;
}

// єдине місце, де вирішується, чи має юзер доступ до дошки і з якою роллю
export async function getBoardAccess(boardId: string, userId: string): Promise<BoardAccess | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    // PENDING — ще лише запрошення, доступу не дає
    include: { members: { where: { userId, status: 'ACCEPTED' } } },
  });
  if (!board) return null;
  if (board.ownerId === userId) {
    return { board, role: 'OWNER', roleGrantedBy: null, memberSince: board.createdAt };
  }

  const membership = board.members[0];
  if (!membership) return null;
  return {
    board,
    role: membership.role,
    roleGrantedBy: membership.roleGrantedBy,
    memberSince: membership.createdAt,
  };
}

// імʼя для списку присутніх. Окремим запитом і раз на коннект: getBoardAccess
// смикають усі rest-роути, там це імʼя не потрібне
// імʼя й фото для кімнати дошки — одним запитом на коннект
export async function getUserCard(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, avatarUrl: true, bio: true },
  });
  return {
    displayName: user?.displayName ?? '',
    avatarUrl: user?.avatarUrl ?? null,
    bio: user?.bio ?? null,
  };
}

export async function getDisplayName(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName ?? '';
}

// чужу дошку (немає жодного доступу) не відрізняємо від неіснуючої — 404
export function requireBoardAccess(access: BoardAccess | null): BoardAccess {
  if (!access) {
    throw new AppError(404, 'BOARD_NOT_FOUND', 'Дошку не знайдено');
  }
  return access;
}

// тут юзер вже знає, що дошка існує (він учасник), тому 403, а не 404
export function requireBoardOwner(access: BoardAccess | null): BoardAccess {
  const resolved = requireBoardAccess(access);
  if (resolved.role !== 'OWNER') {
    throw new AppError(403, 'FORBIDDEN', 'Потрібні права власника дошки');
  }
  return resolved;
}

// керування учасниками: власник і адміністратор. Кого саме можна чіпати —
// вирішує canManageMember уже на місці, бо для цього треба знати роль цілі
// й того, хто ту роль дав
export function requireBoardAdmin(access: BoardAccess | null): BoardAccess {
  const resolved = requireBoardAccess(access);
  if (resolved.role !== 'OWNER' && resolved.role !== 'ADMIN') {
    // окремий код, не загальний FORBIDDEN: саме по ньому панель учасників
    // розуміє, що прав уже нема, і ховається. Решта відмов — про ціль дії,
    // а не про мене, і панель має лишитись на місці (05.10)
    throw new AppError(403, MEMBER_ERROR.NOT_BOARD_MANAGER, 'Потрібні права адміністратора дошки');
  }
  return resolved;
}

// глядачеві можна дивитись, але не міняти вміст
export function requireBoardEditor(access: BoardAccess | null): BoardAccess {
  const resolved = requireBoardAccess(access);
  if (resolved.role === 'VIEWER') {
    throw new AppError(403, 'FORBIDDEN', 'Лише перегляд: змінювати дошку не можна');
  }
  return resolved;
}

export function toBoardSummary(board: Board, userId: string, myRole?: BoardRole): BoardSummary {
  const isOwner = board.ownerId === userId;
  return {
    id: board.id,
    title: board.title,
    ownerId: board.ownerId,
    isOwner,
    myRole: isOwner ? 'OWNER' : (myRole ?? 'VIEWER'),
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  };
}

export function toBoardDetail(
  board: Board,
  members: (BoardMember & { user: User })[],
  userId: string,
): BoardDetail {
  const memberInfos: BoardMemberInfo[] = members.map((m) => ({
    userId: m.userId,
    email: m.user.email,
    displayName: m.user.displayName,
    avatarUrl: m.user.avatarUrl,
    bio: m.user.bio,
    createdAt: m.createdAt.toISOString(),
    role: m.role,
    roleGrantedBy: m.roleGrantedBy,
    status: m.status,
  }));

  const mine = members.find((m) => m.userId === userId);
  return { ...toBoardSummary(board, userId, mine?.role), members: memberInfos };
}
