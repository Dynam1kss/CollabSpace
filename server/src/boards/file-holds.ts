// Резерви місця під файли — у памʼяті кімнати, за зʼєднанням. Саме за
// зʼєднанням, а не за людиною: той, хто видалив картку, тримає місце рівно
// доти, доки сидить на дошці й може натиснути ctrl+z. Пішов, перезайшов,
// обірвався — резерв зник у ту ж мить, і місце побачили всі.
// Перезапуск сервера так само все відпускає: тут нема чого зберігати
const holds = new Map<string, Map<number, Set<string>>>();

export function setHolds(boardId: string, clientId: number, fileIds: string[]) {
  let board = holds.get(boardId);
  if (!board) {
    board = new Map();
    holds.set(boardId, board);
  }
  if (fileIds.length === 0) board.delete(clientId);
  else board.set(clientId, new Set(fileIds));
  if (board.size === 0) holds.delete(boardId);
}

export function clearHolds(boardId: string, clientId: number) {
  const board = holds.get(boardId);
  if (!board) return;
  board.delete(clientId);
  if (board.size === 0) holds.delete(boardId);
}

// Окремо — резерв САМОГО завантаження. Його ставить сервер, а не клієнт:
// інакше між «файл записано» і «клієнт сказав, що тримає його» зяяла б
// дірка, у якій файл не займає місця ні для кого — і двоє одночасних
// завантажень не бачили б одне одного, а клієнт міг би просто ніколи не
// слати резерв і лити скільки завгодно
const uploaded = new Map<string, Map<string, number>>();

export function holdUploaded(boardId: string, fileId: string, until: number) {
  let board = uploaded.get(boardId);
  if (!board) {
    board = new Map();
    uploaded.set(boardId, board);
  }
  board.set(fileId, until);
}

// картка стала в знімок — резерв завантаження більше не потрібен: файл тепер
// рахується як звичайне посилання дошки. Без цього щойно завантажений файл
// тримав місце ще дві хвилини навіть після того, як картку поставили й
// видалили, і місце не звільняв ніхто (журнал 07.10)
export function releaseUploaded(boardId: string, fileIds: Iterable<string>) {
  const board = uploaded.get(boardId);
  if (!board) return;
  for (const id of fileIds) board.delete(id);
  if (board.size === 0) uploaded.delete(boardId);
}

export function heldFileIds(boardId: string, now = Date.now()): Set<string> {
  const out = new Set<string>();
  for (const set of holds.get(boardId)?.values() ?? []) for (const id of set) out.add(id);
  const fresh = uploaded.get(boardId);
  if (fresh) {
    for (const [id, until] of fresh) {
      if (until > now) out.add(id);
      else fresh.delete(id);
    }
    if (fresh.size === 0) uploaded.delete(boardId);
  }
  return out;
}

// лише для перевірок: між ними стан кімнат не має протікати
export function resetHolds() {
  holds.clear();
  uploaded.clear();
}
