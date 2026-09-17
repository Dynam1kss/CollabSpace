import { create } from 'zustand';
import type { BoardObject } from 'shared';

export type ToolId = 'select' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'connector';

// стан UI редактора (інструмент, виділення, текст у режимі редагування) —
// не про самі об'єкти дошки (той стан у board-store) і не про CRDT-синхронізацію,
// суто ефемерний клієнтський стан, який ні з ким не ділиться
interface EditorState {
  activeTool: ToolId;
  selectedIds: string[];
  editingTextId: string | null;
  // йде тягання чи трансформація — контекстна панель на цей час ховається,
  // бо позиції в сторі відстають від вузлів до dragend/transformend
  interacting: boolean;
  // ctrl+c/x — знімки обʼєктів як є; при вставці їм роздаються нові id
  clipboard: BoardObject[];
  setActiveTool: (tool: ToolId) => void;
  select: (id: string) => void;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  startEditingText: (id: string) => void;
  stopEditingText: () => void;
  setInteracting: (value: boolean) => void;
  setClipboard: (objects: BoardObject[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTool: 'select',
  selectedIds: [],
  editingTextId: null,
  interacting: false,
  clipboard: [],

  setActiveTool: (tool) => set({ activeTool: tool, selectedIds: [] }),
  select: (id) => set({ selectedIds: [id] }),
  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((existing) => existing !== id)
        : [...state.selectedIds, id],
    })),
  selectMany: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: [] }),
  startEditingText: (id) => set({ editingTextId: id }),
  stopEditingText: () => set({ editingTextId: null }),
  setInteracting: (value) => set({ interacting: value }),
  setClipboard: (objects) => set({ clipboard: objects }),
}));
