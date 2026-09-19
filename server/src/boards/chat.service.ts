import type { ChatMessageInfo } from 'shared';
import { prisma } from '../prisma';

// запис бази → те, що бачить клієнт. Імʼя автора віддаємо готовим: клієнт
// має показати підпис і тоді, коли автора зараз нема в кімнаті (а отже, і в
// списку присутніх), тому вигадати його з roster не вийде
function toInfo(row: {
  id: string;
  authorId: string;
  text: string;
  createdAt: Date;
  author: { displayName: string };
}): ChatMessageInfo {
  return {
    id: row.id,
    authorId: row.authorId,
    displayName: row.author.displayName,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

// останні limit повідомлень, у порядку від старих до нових. Беремо з кінця
// (desc + take) і перевертаємо — інакше при довгій історії довелось би
// тягнути її всю. Догрузки старіших поки нема: знадобиться — курсор по
// createdAt тієї, що зараз найстарша на екрані
export async function loadChatHistory(boardId: string, limit: number): Promise<ChatMessageInfo[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { boardId },
    // id другим ключем — createdAt має мілісекундну точність, і два
    // повідомлення в ту саму мілісекунду інакше лягали б у випадковому порядку
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { author: { select: { displayName: true } } },
  });
  return rows.reverse().map(toInfo);
}

export async function saveChatMessage(boardId: string, authorId: string, text: string) {
  const row = await prisma.chatMessage.create({
    data: { boardId, authorId, text },
    include: { author: { select: { displayName: true } } },
  });
  return toInfo(row);
}
