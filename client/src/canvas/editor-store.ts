import { create } from 'zustand';
import type { BoardObject } from 'shared';
import { beginUndoGesture, endUndoGesture } from './board-store';
import { lockOwner, usePresenceStore } from './presence-store';

export type ToolId = 'select' | 'sticky' | 'text' | 'rect' | 'ellipse' | 'connector' | 'line' | 'link';

// шар обʼєктів ловить події лише під інструментом вибору. Під будь-яким
// інструментом створення обʼєкти «прозорі» — інакше клік по наявному стікеру
// до Stage не доходив (сам обʼєкт ставив cancelBubble, див. useSelectOnPointerDown),
// і поверх чогось новий обʼєкт не створювався взагалі: доводилось шукати
// порожнє місце (06.10)
export function objectsListen(tool: ToolId) {
  return tool === 'select';
}

// стан UI редактора (інструмент, виділення, текст у режимі редагування) —
// не про самі об'єкти дошки (той стан у board-store) і не про CRDT-синхронізацію,
// суто ефемерний клієнтський стан, який ні з ким не ділиться
interface EditorState {
  // false для глядача (VIEWER): усе, що міняє вміст дошки, на це дивиться —
  // інструменти, драг, трансформер, контекстна панель, хоткеї, редагування
  // тексту. виділяти обʼєкти можна й глядачу, це не зміна стану
  canEdit: boolean;
  activeTool: ToolId;
  selectedIds: string[];
  editingTextId: string | null;
  // картка посилання, якій зараз правлять адресу й підпис (поповер поверх
  // полотна). Окремо від editingTextId: там textarea в самому обʼєкті
  editingLinkId: string | null;
  // інструмент «посилання» чекає адресу: куди ставити картку (координати
  // дошки) і де відкрити поповер (координати полотна)
  linkDraft: { board: { x: number; y: number }; screen: { x: number; y: number } } | null;
  // відео, відкрите накладкою поверх полотна (DOM-iframe, не konva)
  playingVideoId: string | null;
  // йде тягання чи трансформація — контекстна панель на цей час ховається,
  // бо позиції в сторі відстають від вузлів до dragend/transformend
  interacting: boolean;
  // ctrl+c/x — знімки обʼєктів як є; при вставці їм роздаються нові id
  clipboard: BoardObject[];
  // працюють пальцем, а не мишею: від цього залежать зони захвату ручок.
  // Назад у «мишу» не вертаємось — телефон мишею не стане
  touchInput: boolean;
  setCanEdit: (value: boolean) => void;
  setActiveTool: (tool: ToolId) => void;
  select: (id: string) => void;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  startEditingText: (id: string) => void;
  stopEditingText: () => void;
  startEditingLink: (id: string) => void;
  stopEditingLink: () => void;
  openLinkDraft: (board: { x: number; y: number }, screen: { x: number; y: number }) => void;
  closeLinkDraft: () => void;
  playVideo: (videoId: string) => void;
  stopVideo: () => void;
  setInteracting: (value: boolean) => void;
  setClipboard: (objects: BoardObject[]) => void;
  setTouchInput: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  canEdit: false,
  activeTool: 'select',
  selectedIds: [],
  editingTextId: null,
  editingLinkId: null,
  linkDraft: null,
  playingVideoId: null,
  interacting: false,
  clipboard: [],
  touchInput: false,

  // інструмент лишається в сторі між дошками — щоб редактор, перейшовши на
  // чужу дошку глядачем, не приніс із собою «стікер» і не наставив їх тапом
  setCanEdit: (value) => set(value ? { canEdit: true } : { canEdit: false, activeTool: 'select' }),
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
  // у зайнятий обʼєкт не пускаємо: двоє одночасно набрали б у нього текст, і
  // зберігся б лише той, хто вийшов останнім — чужий набір зник би мовчки
  startEditingText: (id) =>
    set((state) => {
      if (!state.canEdit) return state;
      if (lockOwner(usePresenceStore.getState(), id)) return state;
      return { editingTextId: id };
    }),
  stopEditingText: () => set({ editingTextId: null }),
  // те саме правило, що для тексту: у зайняту кимось картку не пускаємо,
  // глядача не пускаємо взагалі
  startEditingLink: (id) =>
    set((state) => {
      if (!state.canEdit) return state;
      if (lockOwner(usePresenceStore.getState(), id)) return state;
      return { editingLinkId: id };
    }),
  stopEditingLink: () => set({ editingLinkId: null }),
  openLinkDraft: (board, screen) =>
    set((state) => (state.canEdit ? { linkDraft: { board, screen } } : state)),
  closeLinkDraft: () => set({ linkDraft: null }),
  // глядачу дивитись можна: це не зміна вмісту
  playVideo: (videoId) => set({ playingVideoId: videoId }),
  stopVideo: () => set({ playingVideoId: null }),
  // заразом межа кроку undo: цілий жест має відкочуватись одним ctrl+z,
  // а не покадрово — board-store пише в документ раз на кадр
  setInteracting: (value) => {
    if (value) beginUndoGesture();
    else endUndoGesture();
    set({ interacting: value });
  },
  setClipboard: (objects) => set({ clipboard: objects }),
  setTouchInput: () => set({ touchInput: true }),
}));
