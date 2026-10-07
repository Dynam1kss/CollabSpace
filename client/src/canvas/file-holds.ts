import { create } from 'zustand';
import type { BoardObject, FileObject } from 'shared';
import { takeLocalRemovals, useBoardStore } from './board-store';

// Що це зʼєднання тримає за собою. Два випадки:
//  — щойно завантажений файл, якому ще не поставили картку;
//  — файл картки, яку видалив Я: поки я на дошці, я ще можу натиснути ctrl+z.
// Поки тримаю — місце зайняте, і це бачать усі в кімнаті. Пішов із дошки чи
// обірвався — сервер відпускає все моє, і місце звільняється для всіх.
//
// Резерв бере САМЕ ТОЙ, ХТО ВИДАЛИВ. Доти його брав кожен, хто побачив, що
// картка зникла, — а бачать усі, і в стратегії 3 «зникла» означало ще й
// «клітинка згорнулась, бо я відвів вікно». Через це місце тримав будь-хто,
// хто просто сидів на дошці, і звільнялось воно лише коли дошку покидали всі
// (журнал 07.10)

interface HoldState {
  held: Set<string>;
}

export const useFileHolds = create<HoldState>(() => ({ held: new Set() }));

let send: ((fileIds: string[]) => void) | null = null;

export function setFileHoldSender(fn: ((fileIds: string[]) => void) | null) {
  send = fn;
  if (fn) flush();
}

function flush() {
  send?.([...useFileHolds.getState().held]);
}

function change(apply: (held: Set<string>) => void) {
  const held = new Set(useFileHolds.getState().held);
  apply(held);
  const before = useFileHolds.getState().held;
  if (held.size === before.size && [...held].every((id) => before.has(id))) return;
  useFileHolds.setState({ held });
  flush();
}

// картку ще не поставили, а файл уже на сервері. Відпустимо, щойно картка
// зʼявиться на дошці; від аплоада до запису знімка місце тримає сам сервер
export function holdUploadedFile(fileId: string) {
  change((held) => held.add(fileId));
}

export function clearFileHolds() {
  if (useFileHolds.getState().held.size === 0) return;
  useFileHolds.setState({ held: new Set() });
  flush();
}

export function fileCardIds(objects: Record<string, BoardObject>) {
  const byObject = new Map<string, string>();
  for (const object of Object.values(objects)) {
    if (object.type === 'file') byObject.set(object.id, (object as FileObject).fileId);
  }
  return byObject;
}

// стежимо за дошкою: МОЯ правка прибрала картку файла — беру його id на себе.
// картка знову на дошці (ctrl+z, або хтось повернув) — відпускаю; цим же
// відпускається й резерв завантаження, коли картка нарешті стала на місце
export function watchFileHolds() {
  let previous = fileCardIds(useBoardStore.getState().objects);
  takeLocalRemovals(); // те, що накопичилось до підписки, до резервів не стосується
  return useBoardStore.subscribe((state, prev) => {
    if (state.objects === prev.objects) return;
    const now = fileCardIds(state.objects);
    const removed = takeLocalRemovals();
    const present = new Set(now.values());
    change((held) => {
      for (const objectId of removed) {
        const fileId = previous.get(objectId);
        if (fileId && !present.has(fileId)) held.add(fileId);
      }
      for (const fileId of present) held.delete(fileId);
    });
    previous = now;
  });
}
