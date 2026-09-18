import { createId } from '@paralleldrive/cuid2';
import type { BoardObject } from 'shared';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { withPoints } from './objects/connector-geometry';

// копія лягає не точно поверх оригіналу, а трохи вбік (координати дошки)
// зсув цілого обʼєкта: у конектора рухаються самі точки, у решти — x/y
function moveByDelta(obj: BoardObject, dx: number, dy: number) {
  if (obj.type === 'connector') {
    return withPoints(obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  }
  return { x: obj.x + dx, y: obj.y + dy };
}

const PASTE_OFFSET = 20;

export function nextZIndex() {
  const all = useBoardStore.getState().getAll();
  return all.length === 0 ? 0 : Math.max(...all.map((o) => o.zIndex)) + 1;
}

function selectedObjects() {
  const { selectedIds } = useEditorStore.getState();
  const { getById } = useBoardStore.getState();
  return selectedIds.map(getById).filter((o): o is BoardObject => !!o);
}

// одна дія і для Delete/Backspace, і для кошика на контекстній панелі
export function deleteSelected() {
  const { selectedIds, clearSelection } = useEditorStore.getState();
  if (selectedIds.length === 0) return;
  useBoardStore.getState().removeMany(selectedIds);
  clearSelection();
}

export function selectAll() {
  useEditorStore.getState().selectMany(
    useBoardStore
      .getState()
      .getAll()
      .map((o) => o.id),
  );
}

export function copySelected() {
  const objects = selectedObjects();
  if (objects.length > 0) useEditorStore.getState().setClipboard(objects);
}

export function cutSelected() {
  copySelected();
  deleteSelected();
}

// буфер після вставки підміняється щойно вставленими копіями — так наступний
// ctrl+v лягає ще на крок далі, а не поверх попередньої вставки
export function pasteClipboard(createdBy: string) {
  const { clipboard, setClipboard } = useEditorStore.getState();
  if (clipboard.length === 0) return;
  const clones = addClones(clipboard, createdBy);
  setClipboard(clones);
}

export function duplicateSelected(createdBy: string) {
  const objects = selectedObjects();
  if (objects.length > 0) addClones(objects, createdBy);
}

// копії з новими id, зверху за z (порядок шарів між собою зберігається),
// зі зсувом — і одразу стають виділенням. Конектор копіюється як є: його
// points самодостатні, ні на що не посилаються
function addClones(objects: BoardObject[], createdBy: string): BoardObject[] {
  const { add } = useBoardStore.getState();
  let zIndex = nextZIndex();
  const clones = [...objects]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map(
      (o) =>
        ({
          ...o,
          ...moveByDelta(o, PASTE_OFFSET, PASTE_OFFSET),
          id: createId(),
          zIndex: zIndex++,
          createdBy,
          createdAt: new Date().toISOString(),
        }) as BoardObject,
    );
  for (const clone of clones) add(clone);
  useEditorStore.getState().selectMany(clones.map((c) => c.id));
  return clones;
}
