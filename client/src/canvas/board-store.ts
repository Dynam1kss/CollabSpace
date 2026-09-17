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
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  getAll: () => BoardObject[];
  getById: (id: string) => BoardObject | undefined;
}

// джерело правди — CRDT-документ; поки без мережі, але вже в тій формі, яку
// потім синхронізуватиме провайдер. ключ — id обʼєкта, значення — цілий обʼєкт
export const boardDoc = new Y.Doc();
const yObjects = boardDoc.getMap<BoardObject>('objects');

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

  remove: (id) => yObjects.delete(id),

  // одна транзакція — один observe і одне оновлення для мережі, а не N
  removeMany: (ids) =>
    boardDoc.transact(() => {
      for (const id of ids) yObjects.delete(id);
    }),

  getAll: () => Object.values(get().objects),
  getById: (id) => get().objects[id],
}));

// будь-яка зміна мапи (своя чи згодом чужа з мережі) → перезбираємо дзеркало
// лише по зачеплених ключах; нове посилання objects — React перемальовує як і раніше
yObjects.observe((event) => {
  useBoardStore.setState((state) => {
    const objects = { ...state.objects };
    for (const key of event.keysChanged) {
      const value = yObjects.get(key);
      if (value === undefined) delete objects[key];
      else objects[key] = value;
    }
    return { objects };
  });
});
