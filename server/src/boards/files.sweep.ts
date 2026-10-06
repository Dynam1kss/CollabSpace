import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../prisma';
import { FILES_DIR } from './files.routes';

// Видаляти файл разом із карткою не можна: ctrl+z має повернути картку живою,
// а не з битим посиланням. Тому прибираємо окремо й із запасом часу — файл,
// на який ніхто не посилається ДОВШЕ ЗА ДОБУ, вже точно нікому не потрібен
export const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

// Як шукаємо посилання: вміст дошки лежить у знімку (BoardSnapshotCell або
// BoardSnapshot) і в збережених версіях — усе це json з масивом обʼєктів.
// Беремо з них обʼєкти type === 'file' і їхні fileId. Версії враховуємо
// навмисно: інакше відкат до старої версії дав би картку без файла
function fileIdsIn(state: Buffer): string[] {
  try {
    const objects = JSON.parse(state.toString('utf8')) as { type?: string; fileId?: string }[];
    if (!Array.isArray(objects)) return [];
    return objects.filter((o) => o?.type === 'file' && typeof o.fileId === 'string').map((o) => o.fileId!);
  } catch {
    // нерозбірливий знімок — вважаємо, що посилань у ньому нема; сам файл
    // усе одно переживе добу, і наступний прохід його перевірить ще раз
    return [];
  }
}

export async function referencedFileIds(boardId: string): Promise<Set<string>> {
  const [cells, snapshot, versions] = await Promise.all([
    prisma.boardSnapshotCell.findMany({ where: { boardId }, select: { state: true } }),
    prisma.boardSnapshot.findUnique({ where: { boardId }, select: { state: true } }),
    prisma.boardVersion.findMany({ where: { boardId }, select: { state: true } }),
  ]);
  const ids = new Set<string>();
  for (const row of cells) for (const id of fileIdsIn(row.state)) ids.add(id);
  if (snapshot) for (const id of fileIdsIn(snapshot.state)) ids.add(id);
  for (const row of versions) for (const id of fileIdsIn(row.state)) ids.add(id);
  return ids;
}

// один прохід прибирача. Повертає, скільки файлів прибрано — щоб було що
// написати в лог і що перевірити в тесті
export async function sweepOrphanFiles(now = Date.now()): Promise<number> {
  const old = await prisma.boardFile.findMany({
    where: { createdAt: { lt: new Date(now - ORPHAN_AGE_MS) } },
    select: { id: true, boardId: true, storageName: true },
  });
  if (old.length === 0) return 0;

  const byBoard = new Map<string, typeof old>();
  for (const file of old) byBoard.set(file.boardId, [...(byBoard.get(file.boardId) ?? []), file]);

  let removed = 0;
  for (const [boardId, files] of byBoard) {
    const referenced = await referencedFileIds(boardId);
    const orphans = files.filter((f) => !referenced.has(f.id));
    for (const file of orphans) {
      await unlink(resolve(FILES_DIR, file.storageName)).catch(() => {});
    }
    if (orphans.length > 0) {
      await prisma.boardFile.deleteMany({ where: { id: { in: orphans.map((f) => f.id) } } });
      removed += orphans.length;
    }
  }
  return removed;
}

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export function startOrphanSweep() {
  const timer = setInterval(() => {
    void sweepOrphanFiles().catch(() => {});
  }, SWEEP_EVERY_MS);
  // таймер не має тримати процес живим
  timer.unref();
  return timer;
}
