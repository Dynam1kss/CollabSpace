import { FILE_QUOTA_GRACE_MS, FILE_STORED_CAP_FACTOR } from 'shared';
import { prisma } from '../prisma';
import { env } from '../env';

type Tx = Pick<typeof prisma, 'boardFile' | 'boardSnapshotCell' | 'boardSnapshot'>;

// Квоту рахуємо не по всьому, що лежить на диску, а по тому, що дошка справді
// ВИКОРИСТОВУЄ. Інакше виходило так: видалив картку — місце не звільнилось, бо
// файл лежить до прибирача (а він раз на добу), і той самий файл уже не
// завантажити. Файли без картки лишаються на диску заради ctrl+z і збережених
// версій, але місця більше не займають
function fileIdsIn(state: Buffer): string[] {
  try {
    const objects = JSON.parse(state.toString('utf8')) as { type?: string; fileId?: string }[];
    if (!Array.isArray(objects)) return [];
    return objects.filter((o) => o?.type === 'file' && typeof o.fileId === 'string').map((o) => o.fileId!);
  } catch {
    return [];
  }
}

// ПОТОЧНИЙ стан дошки — клітинки знімка (або старий суцільний знімок).
// Збережені версії сюди НЕ входять: вони тримають файл живим для відкату, але
// займати місце в квоті не мають. Беремо з бази, тому клітинки, яких у когось
// не завантажено (стратегія 3), однаково рахуються
export async function currentFileIds(boardId: string, tx: Tx = prisma): Promise<Set<string>> {
  const [cells, snapshot] = await Promise.all([
    tx.boardSnapshotCell.findMany({ where: { boardId }, select: { state: true } }),
    tx.boardSnapshot.findUnique({ where: { boardId }, select: { state: true } }),
  ]);
  const ids = new Set<string>();
  for (const row of cells) for (const id of fileIdsIn(row.state)) ids.add(id);
  if (snapshot) for (const id of fileIdsIn(snapshot.state)) ids.add(id);
  return ids;
}

export interface QuotaUsage {
  // що займає місце: файли поточного стану плюс щойно завантажені
  usedBytes: number;
  // усе, що лежить на диску цієї дошки, разом із покинутим
  storedBytes: number;
  quotaBytes: number;
  storedCapBytes: number;
}

export async function boardQuotaUsage(boardId: string, tx: Tx = prisma, now = Date.now()): Promise<QuotaUsage> {
  const [files, current] = await Promise.all([
    tx.boardFile.findMany({ where: { boardId }, select: { id: true, size: true, createdAt: true } }),
    currentFileIds(boardId, tx),
  ]);
  const fresh = now - FILE_QUOTA_GRACE_MS;
  let usedBytes = 0;
  let storedBytes = 0;
  for (const file of files) {
    storedBytes += file.size;
    // щойно завантажений ще не встиг потрапити в знімок — його теж рахуємо,
    // інакше квоту можна було б обійти, заливаючи файли й не ставлячи карток
    if (current.has(file.id) || file.createdAt.getTime() > fresh) usedBytes += file.size;
  }
  return {
    usedBytes,
    storedBytes,
    quotaBytes: env.boardFilesMaxBytes,
    storedCapBytes: env.boardFilesMaxBytes * FILE_STORED_CAP_FACTOR,
  };
}

// серіалізація саме по дошці: два одночасні завантаження інакше обидва
// проходять перевірку й разом перебирають межу. Блокування живе до кінця
// транзакції, знімати руками не треба
export async function lockBoardQuota(tx: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number> }, boardId: string) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', boardId);
}
