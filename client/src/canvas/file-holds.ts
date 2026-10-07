import { create } from 'zustand';
import { FILE_UPLOAD_HOLD_MS } from 'shared';
import type { FileObject } from 'shared';
import { useBoardStore } from './board-store';

// Що це зʼєднання тримає за собою. Два випадки:
//  — щойно завантажений файл, якому ще не поставили картку;
//  — файл видаленої картки: поки я на дошці, я ще можу натиснути ctrl+z.
// Поки тримаю — місце зайняте, і це бачать усі в кімнаті. Пішов із дошки чи
// обірвався — сервер відпускає все моє, і місце звільняється для всіх
const RELEASE_AFTER_MS = FILE_UPLOAD_HOLD_MS;

interface HoldState {
  // fileId -> коли відпустити самому (для завантажених); у видалених таймера
  // немає: тримаємо, доки не підемо з дошки
  held: Map<string, number | null>;
}

export const useFileHolds = create<HoldState>(() => ({ held: new Map() }));

let send: ((fileIds: string[]) => void) | null = null;

export function setFileHoldSender(fn: ((fileIds: string[]) => void) | null) {
  send = fn;
  if (fn) flush();
}

function flush() {
  send?.([...useFileHolds.getState().held.keys()]);
}

function change(apply: (held: Map<string, number | null>) => void) {
  const held = new Map(useFileHolds.getState().held);
  const before = held.size;
  apply(held);
  // не шлемо кадр, якщо нічого не змінилось
  if (held.size === before && [...held.keys()].every((k) => useFileHolds.getState().held.has(k))) return;
  useFileHolds.setState({ held });
  flush();
}

export function holdUploadedFile(fileId: string) {
  change((held) => held.set(fileId, Date.now() + RELEASE_AFTER_MS));
  window.setTimeout(() => releaseFile(fileId), RELEASE_AFTER_MS);
}

export function releaseFile(fileId: string) {
  change((held) => held.delete(fileId));
}

export function clearFileHolds() {
  if (useFileHolds.getState().held.size === 0) return;
  useFileHolds.setState({ held: new Map() });
  flush();
}

// стежимо за дошкою: зник обʼєкт файла — беремо його id на себе; зʼявився
// назад (ctrl+z) — відпускаємо
export function watchFileHolds() {
  let previous = fileIdsOf(useBoardStore.getState().objects);
  return useBoardStore.subscribe((state, prev) => {
    if (state.objects === prev.objects) return;
    const now = fileIdsOf(state.objects);
    change((held) => {
      for (const [id] of previous) if (!now.has(id)) held.set(id, null);
      for (const [id] of now) if (held.get(id) === null) held.delete(id);
    });
    previous = now;
  });
}

function fileIdsOf(objects: Record<string, { type: string }>) {
  const ids = new Map<string, true>();
  for (const object of Object.values(objects)) {
    if (object.type === 'file') ids.set((object as FileObject).fileId, true);
  }
  return ids;
}
