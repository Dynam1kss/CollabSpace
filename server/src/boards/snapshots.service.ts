import { prisma } from '../prisma';

// читання й запис BoardSnapshot.state — спільне для збереження з клієнта й
// для відкату версії, щоб у базу вміст лягав одним шляхом
export async function readSnapshotState(boardId: string) {
  const snapshot = await prisma.boardSnapshot.findUnique({ where: { boardId }, select: { state: true } });
  return snapshot?.state ?? null;
}

export async function writeSnapshotState(boardId: string, state: Buffer) {
  await prisma.boardSnapshot.upsert({
    where: { boardId },
    create: { boardId, state },
    update: { state },
  });
}
