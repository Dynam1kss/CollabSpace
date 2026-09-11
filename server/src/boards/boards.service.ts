import type { Board, BoardMember, BoardRole, User } from '@prisma/client';
import type { BoardDetail, BoardMemberInfo, BoardSummary } from 'shared';
import { AppError } from '../errors';
import { prisma } from '../prisma';

export interface BoardAccess {
  board: Board;
  role: 'OWNER' | BoardRole;
}

// єдине місце, де вирішується, чи має юзер доступ до дошки і з якою роллю
export async function getBoardAccess(boardId: string, userId: string): Promise<BoardAccess | null> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    include: { members: { where: { userId } } },
  });
  if (!board) return null;
  if (board.ownerId === userId) return { board, role: 'OWNER' };

  const membership = board.members[0];
  if (!membership) return null;
  return { board, role: membership.role };
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

export function toBoardSummary(board: Board, userId: string): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    ownerId: board.ownerId,
    isOwner: board.ownerId === userId,
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
    role: m.role,
  }));

  return { ...toBoardSummary(board, userId), members: memberInfos };
}
