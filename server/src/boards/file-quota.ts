import { prisma } from '../prisma';
import { env } from '../env';
import { heldFileIds } from './file-holds';

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
  // ЄДИНЕ число: і підказка на кнопці, і поріг відмови рахуються з нього.
  // Файли, на які ніхто не посилається й ніхто їх не тримає, місця не
  // займають — навіть якщо ще лежать на диску до найближчого прибирача
  usedBytes: number;
  // скільки лежить на диску — лише для журналу й перевірок, на відмову НЕ впливає
  storedBytes: number;
  quotaBytes: number;
}

export async function boardQuotaUsage(boardId: string, tx: Tx = prisma): Promise<QuotaUsage> {
  const [files, current] = await Promise.all([
    tx.boardFile.findMany({ where: { boardId }, select: { id: true, size: true } }),
    currentFileIds(boardId, tx),
  ]);
  const held = heldFileIds(boardId);
  let usedBytes = 0;
  let storedBytes = 0;
  for (const file of files) {
    storedBytes += file.size;
    if (current.has(file.id) || held.has(file.id)) usedBytes += file.size;
  }
  return { usedBytes, storedBytes, quotaBytes: env.boardFilesMaxBytes };
}

// серіалізація саме по дошці: два одночасні завантаження інакше обидва
// проходять перевірку й разом перебирають межу. Блокування живе до кінця
// транзакції, знімати руками не треба
export async function lockBoardQuota(tx: { $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number> }, boardId: string) {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', boardId);
}
