import { Router } from 'express';
import type { Request } from 'express';
import { CHAT_HISTORY_LIMIT } from 'shared';
import type { ChatHistoryResponse } from 'shared';
import { requireAuth } from '../auth/auth.middleware';
import { getBoardAccess, requireBoardAccess } from './boards.service';
import { loadChatHistory } from './chat.service';

// історія чату дошки. Читати може будь-хто з доступом, глядач теж: чат —
// не вміст дошки, за роллю тут нічого не гейтимо (як і присутність).
// Писати сюди не можна: повідомлення йдуть сокетом, див. board-rooms
export const chatRouter = Router({ mergeParams: true });

chatRouter.use(requireAuth);

chatRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const access = requireBoardAccess(await getBoardAccess(req.params.id, req.userId as string));
    const body: ChatHistoryResponse = {
      messages: await loadChatHistory(access.board.id, CHAT_HISTORY_LIMIT),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
