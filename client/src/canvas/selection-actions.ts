import { createId } from '@paralleldrive/cuid2';
import type { BoardObject } from 'shared';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { lockedObjectIds, usePresenceStore } from './presence-store';
import { deletableIds } from './object-lock';
import { withPoints } from './objects/point-box';
import { createAtPoint } from './object-defaults';
import type { CreatableTool } from './object-defaults';
import type { Point } from './coordinates';

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

// створити обʼєкт активним інструментом у точці дошки. Після створення
// інструмент вертається на «вибір», а новий обʼєкт стає виділеним. Порядок
// важливий: setActiveTool сама скидає selectedIds, тому виділяємо після неї
export function createWithTool(tool: CreatableTool, point: Point, createdBy: string) {
  const object = createAtPoint(tool, point, { createdBy, zIndex: nextZIndex() });
  useBoardStore.getState().add(object);
  const { setActiveTool, select } = useEditorStore.getState();
  setActiveTool('select');
  select(object.id);
  return object;
}

function selectedObjects() {
  const { selectedIds } = useEditorStore.getState();
  const { getById } = useBoardStore.getState();
  return selectedIds.map(getById).filter((o): o is BoardObject => !!o);
}

// одна дія і для Delete/Backspace, і для кошика на контекстній панелі.
// Зайняте кимось іншим і замкнене прапорцем пропускаємо — решту виділеного
// видаляємо як і було. Замкнене саме тому й замикають: випадкове видалення —
// найдорожча з випадковостей, тому спершу відімкни
export function deleteSelected() {
  const { selectedIds, clearSelection } = useEditorStore.getState();
  if (selectedIds.length === 0) return;
  const { getById } = useBoardStore.getState();
  const free = deletableIds(selectedIds.map(getById), lockedObjectIds(usePresenceStore.getState()));
  if (free.length === 0) return;
  useBoardStore.getState().removeMany(free);
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
