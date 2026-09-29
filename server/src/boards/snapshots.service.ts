import { cellOfObject } from 'shared';
import type { BoardObject } from 'shared';
import { prisma } from '../prisma';

// вміст дошки лежить по клітинках сітки — окремий рядок на (дошка, клітинка).
// Доти був один json на дошку, і збереження частини дошки мусило прочитати
// весь знімок, підмішати свої клітинки й записати назад. Двоє, що зберігали
// різні ділянки одночасно (у стратегії 3 це норма), читали обидва старий стан,
// і той, хто записував другим, стирав щойно збережене першим. Тепер вони
// просто пишуть у різні рядки, і зливати нема чого

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const encode = (objects: BoardObject[]) => Buffer.from(JSON.stringify(objects), 'utf8');
const decode = (state: Buffer) => JSON.parse(state.toString('utf8')) as BoardObject[];

function groupByCell(objects: BoardObject[]) {
  const byCell = new Map<string, BoardObject[]>();
  for (const object of objects) {
    const cell = cellOfObject(object);
    const list = byCell.get(cell);
    if (list) list.push(object);
    else byCell.set(cell, [object]);
  }
  return byCell;
}

// поки дошку жодного разу не зберегли після переходу на клітинки, правда
// лежить у старому цілому знімку. Розкладаємо його перед першим же записом і в
// тій самій транзакції. skipDuplicates, а не upsert: якщо сусід уже встиг
// записати свою клітинку, старий вміст не має її затерти
async function splitLegacy(tx: Tx, boardId: string) {
  const legacy = await tx.boardSnapshot.findUnique({ where: { boardId }, select: { state: true } });
  if (!legacy) return;
  const data = [...groupByCell(decode(legacy.state))].map(([cell, objects]) => ({
    boardId,
    cell,
    state: encode(objects),
    updatedAt: new Date(),
  }));
  if (data.length > 0) await tx.boardSnapshotCell.createMany({ data, skipDuplicates: true });
  // deleteMany, а не delete: другу транзакцію, що робить те саме, відсутній
  // рядок не має валити
  await tx.boardSnapshot.deleteMany({ where: { boardId } });
}

export async function readSnapshot(boardId: string) {
  const cells = await prisma.boardSnapshotCell.findMany({
    where: { boardId },
    orderBy: { cell: 'asc' },
    select: { state: true, updatedAt: true },
  });
  if (cells.length > 0) {
    return {
      objects: cells.flatMap((c) => decode(c.state)),
      updatedAt: cells.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), cells[0].updatedAt),
    };
  }
  // дошку ще не зберігали після переходу на клітинки
  const legacy = await prisma.boardSnapshot.findUnique({ where: { boardId } });
  if (!legacy) return null;
  return { objects: decode(legacy.state), updatedAt: legacy.updatedAt };
}

// увесь вміст дошки одним буфером — таким його бачить історія версій
export async function readSnapshotState(boardId: string) {
  const snapshot = await readSnapshot(boardId);
  return snapshot ? encode(snapshot.objects) : null;
}

// замінити дошку цілком: так пише відкат до версії і збереження від клієнта,
// який тримає всю дошку (стратегії 1/2). Разом, однією транзакцією, — інакше
// між прибиранням старих клітинок і записом нових дошка видно порожньою
export async function writeSnapshotState(boardId: string, state: Buffer) {
  const byCell = groupByCell(decode(state));
  await prisma.$transaction(async (tx) => {
    await tx.boardSnapshot.deleteMany({ where: { boardId } });
    await tx.boardSnapshotCell.deleteMany({ where: { boardId } });
    const data = [...byCell].map(([cell, objects]) => ({
      boardId,
      cell,
      state: encode(objects),
      updatedAt: new Date(),
    }));
    if (data.length > 0) await tx.boardSnapshotCell.createMany({ data });
  });
}

// зберегти рівно перелічені клітинки. Чужих рядків не торкаємось узагалі —
// саме тому одночасне збереження двох різних ділянок більше не гонитва.
// Порожня клітинка — це рядок, який прибираємо: в ній справді нічого нема
export async function writeSnapshotCells(boardId: string, cells: string[], objects: BoardObject[]) {
  const mine = new Set(cells);
  const byCell = groupByCell(objects.filter((o) => mine.has(cellOfObject(o))));
  await prisma.$transaction(async (tx) => {
    await splitLegacy(tx, boardId);
    for (const cell of cells) {
      const list = byCell.get(cell);
      if (!list || list.length === 0) {
        await tx.boardSnapshotCell.deleteMany({ where: { boardId, cell } });
        continue;
      }
      const state = encode(list);
      await tx.boardSnapshotCell.upsert({
        where: { boardId_cell: { boardId, cell } },
        create: { boardId, cell, state },
        update: { state },
      });
    }
  });
}

// скільки обʼєктів зараз у цих клітинках — для журналу збереження
export async function countInCells(boardId: string, cells: string[]) {
  const rows = await prisma.boardSnapshotCell.findMany({
    where: { boardId, cell: { in: cells } },
    select: { state: true },
  });
  return rows.reduce((n, r) => n + decode(r.state).length, 0);
}
