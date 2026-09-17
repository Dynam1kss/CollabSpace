import { create } from 'zustand';
import type { BoardObject, ConnectorObject, ShapeObject, StickyObject, TextObject } from 'shared';

// патч без id/type — не можна підмінити, чим є обʼєкт, лише його властивості
type BoardObjectPatch =
  | Partial<Omit<StickyObject, 'id' | 'type'>>
  | Partial<Omit<TextObject, 'id' | 'type'>>
  | Partial<Omit<ShapeObject, 'id' | 'type'>>
  | Partial<Omit<ConnectorObject, 'id' | 'type'>>;

interface BoardObjectsState {
  // внутрішнє представлення. Решта коду працює тільки через методи нижче —
  // наступного тижня це поле піде під CRDT (Yjs Y.Map), інтерфейс лишиться той самий
  objects: Record<string, BoardObject>;
  add: (object: BoardObject) => void;
  update: (id: string, patch: BoardObjectPatch) => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  getAll: () => BoardObject[];
  getById: (id: string) => BoardObject | undefined;
}

export const useBoardStore = create<BoardObjectsState>((set, get) => ({
  objects: {},

  add: (object) =>
    set((state) => ({
      objects: { ...state.objects, [object.id]: object },
    })),

  update: (id, patch) =>
    set((state) => {
      const existing = state.objects[id];
      if (!existing) return state;
      return {
        objects: { ...state.objects, [id]: { ...existing, ...patch } as BoardObject },
      };
    }),

  remove: (id) =>
    set((state) => {
      if (!(id in state.objects)) return state;
      const objects = { ...state.objects };
      delete objects[id];
      return { objects };
    }),

  removeMany: (ids) =>
    set((state) => {
      const objects = { ...state.objects };
      for (const id of ids) delete objects[id];
      return { objects };
    }),

  getAll: () => Object.values(get().objects),
  getById: (id) => get().objects[id],
}));
