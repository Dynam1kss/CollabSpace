import * as Y from 'yjs';
import { create } from 'zustand';
import type {
  BoardObject,
  ConnectorObject,
  ImageObject,
  ShapeObject,
  StickyObject,
  TextObject,
} from 'shared';

// патч без id/type — не можна підмінити, чим є обʼєкт, лише його властивості
type BoardObjectPatch =
  | Partial<Omit<StickyObject, 'id' | 'type'>>
  | Partial<Omit<TextObject, 'id' | 'type'>>
  | Partial<Omit<ShapeObject, 'id' | 'type'>>
  | Partial<Omit<ConnectorObject, 'id' | 'type'>>
  | Partial<Omit<ImageObject, 'id' | 'type'>>;

interface BoardObjectsState {
  // дзеркало Y.Map нижче, лише для читання: React підписується на нього як на
  // звичайний zustand-стан; пишуть усі тільки через методи, а ті — в Y.Map
  objects: Record<string, BoardObject>;
  add: (object: BoardObject) => void;
  update: (id: string, patch: BoardObjectPatch) => void;
  // те саме, але з відкладеним записом — див. коментар біля черги нижче
  updateSoon: (id: string, patch: BoardObjectPatch) => void;
  flushUpdates: () => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  getAll: () => BoardObject[];
  getById: (id: string) => BoardObject | undefined;
}

// джерело правди — CRDT-документ, який useBoardSync ганяє між клієнтами.
// ключ — id обʼєкта, значення — цілий обʼєкт. документ — один на відкриту
// дошку: resetBoardDoc нижче дає свіжий, бо історія й clientID попередньої
// дошки не мають потрапити в кімнату іншої (yjs тримає клоки без пропусків
// на кожного клієнта, чужа історія ламала б це)
export let boardDoc = new Y.Doc();
let yObjects = boardDoc.getMap<BoardObject>('objects');

// посеред жесту стор пишеться щокадру, і для групи це виходить N² записів:
// konva прокидає drag трансформера на всі виділені вузли, а обробник кожного
// ще й рухає решту. кожен запис окремо — це окрема транзакція й окремий пакет
// у мережу; приймач не встигає їх розбирати, черга в сокеті росте, і серверний
// ping застрягає за нею — два пропущені pong, і сервер рве сокет живому
// клієнту (журнал 20.09). Тому правки жесту складаємо тут і кладемо однією
// транзакцією раз на кадр: один пакет незалежно від розміру виділення
let queued: Map<string, BoardObjectPatch> | null = null;
let frameQueued = false;
// у vitest rAF немає — там мікротаска, аби не падало
const nextFrame: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame : queueMicrotask;

export const useBoardStore = create<BoardObjectsState>((set, get) => ({
  objects: {},

  add: (object) => yObjects.set(object.id, object),

  // злиття цілого обʼєкта: у Y.Map лягає новий обʼєкт, а не окремі поля —
  // одночасна правка одного обʼєкта двома людьми зведеться до «останній виграв»
  update: (id, patch) => {
    const existing = yObjects.get(id);
    if (!existing) return;
    yObjects.set(id, { ...existing, ...patch } as BoardObject);
  },

  updateSoon: (id, patch) => {
    queued ??= new Map();
    queued.set(id, { ...queued.get(id), ...patch } as BoardObjectPatch);
    if (frameQueued) return;
    frameQueued = true;
    nextFrame(() => {
      frameQueued = false;
      get().flushUpdates();
    });
  },

  // жест скінчився — дописуємо залишок одразу, не чекаючи кадру: далі
  // SelectionOverlay перечіпляє трансформер і має бачити вже кінцеві розміри
  flushUpdates: () => {
    const batch = queued;
    queued = null;
    if (!batch) return;
    boardDoc.transact(() => {
      for (const [id, patch] of batch) get().update(id, patch);
    });
  },

  remove: (id) => yObjects.delete(id),

  // одна транзакція — один observe і одне оновлення для мережі, а не N
  removeMany: (ids) =>
    boardDoc.transact(() => {
      for (const id of ids) yObjects.delete(id);
    }),

  getAll: () => Object.values(get().objects),
  getById: (id) => get().objects[id],
}));

// будь-яка зміна мапи (своя чи чужа з мережі) → перезбираємо дзеркало лише
// по зачеплених ключах; нове посилання objects — React перемальовує як і раніше
function mirror(event: Y.YMapEvent<BoardObject>) {
  useBoardStore.setState((state) => {
    const objects = { ...state.objects };
    for (const key of event.keysChanged) {
      const value = yObjects.get(key);
      if (value === undefined) delete objects[key];
      else objects[key] = value;
    }
    return { objects };
  });
}
yObjects.observe(mirror);

export function resetBoardDoc() {
  // недописаний жест зі старої дошки в нову не переносимо
  queued = null;
  boardDoc.destroy();
  boardDoc = new Y.Doc();
  yObjects = boardDoc.getMap<BoardObject>('objects');
  yObjects.observe(mirror);
  useBoardStore.setState({ objects: {} });
  return boardDoc;
}
