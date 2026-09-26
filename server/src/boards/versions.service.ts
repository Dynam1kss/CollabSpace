import type { BoardVersionInfo } from 'shared';
import { prisma } from '../prisma';

// скільки версій тримаємо на дошку. Стан — увесь вміст дошки, тож без межі
// історія жвавої дошки росла б без кінця
export const VERSION_CAP = 20;
// автозбереження не частіше: знімок пишеться раз на 2.5с після кожної правки,
// і версія на кожен такий запис забила б усі 20 місць за хвилину роботи
export const AUTO_VERSION_INTERVAL_MS = 10 * 60_000;

// час передаємо ззовні, щоб правило перевірялось тестом без справжнього очікування
export function shouldCreateAutoVersion(lastAutoAt: Date | null, now: Date) {
  if (!lastAutoAt) return true;
  return now.getTime() - lastAutoAt.getTime() >= AUTO_VERSION_INTERVAL_MS;
}

interface VersionRow {
  id: string;
  createdAt: Date;
  isManual: boolean;
}

// кого прибрати, щоб лишилось не більше cap. Першими йдуть найстаріші
// автоматичні: ручну версію людина назвала сама, це свідома точка, до якої
// збирались вертатись, а автоматичних за годину роботи набереться ще. Ручні
// не чіпаємо взагалі — якщо всі місця зайняті ними, історія трохи вилазить за
// межу, і це краще, ніж мовчки стерти чиєсь «перед презентацією»
export function pickEvictions(versions: VersionRow[], cap = VERSION_CAP): string[] {
  const excess = versions.length - cap;
  if (excess <= 0) return [];
  return versions
    .filter((v) => !v.isManual)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, excess)
    .map((v) => v.id);
}

async function applyRetention(boardId: string) {
  const versions = await prisma.boardVersion.findMany({
    where: { boardId },
    select: { id: true, createdAt: true, isManual: true },
  });
  const evict = pickEvictions(versions);
  if (evict.length > 0) await prisma.boardVersion.deleteMany({ where: { id: { in: evict } } });
  const left = versions.length - evict.length;
  if (left > VERSION_CAP) {
    console.warn(
      `[versions] ${new Date().toISOString()} ручних версій більше за межу — не видаляю`,
      JSON.stringify({ boardId, версій: left, межа: VERSION_CAP }),
    );
  }
}

export async function createVersion(
  boardId: string,
  state: Buffer,
  createdBy: string,
  manual: { label: string | null } | null,
) {
  const version = await prisma.boardVersion.create({
    data: { boardId, state, createdBy, label: manual?.label ?? null, isManual: !!manual },
  });
  await applyRetention(boardId);
  return version;
}

// викликається з кожного збереження снепшота: версія лише тоді, коли з
// останньої автоматичної минуло досить часу. Ручні на відлік не впливають —
// «зберіг вручну» не означає, що наступна автоматична вже не потрібна
export async function maybeCreateAutoVersion(boardId: string, state: Buffer, createdBy: string, now: Date) {
  const last = await prisma.boardVersion.findFirst({
    where: { boardId, isManual: false },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!shouldCreateAutoVersion(last?.createdAt ?? null, now)) return;
  await createVersion(boardId, state, createdBy, null);
}

export async function listVersions(boardId: string): Promise<BoardVersionInfo[]> {
  const versions = await prisma.boardVersion.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, label: true, isManual: true, createdBy: true },
  });
  // імена одним запитом на весь список, а не по запиту на рядок
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(versions.map((v) => v.createdBy))] } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return versions.map((v) => ({
    id: v.id,
    createdAt: v.createdAt.toISOString(),
    label: v.label,
    isManual: v.isManual,
    createdByName: names.get(v.createdBy) ?? 'колишній учасник',
  }));
}

export function toVersionInfo(
  v: { id: string; createdAt: Date; label: string | null; isManual: boolean },
  createdByName: string,
): BoardVersionInfo {
  return {
    id: v.id,
    createdAt: v.createdAt.toISOString(),
    label: v.label,
    isManual: v.isManual,
    createdByName,
  };
}
