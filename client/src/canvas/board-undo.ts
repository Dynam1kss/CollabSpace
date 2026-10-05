import { performRedo, performUndo, useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';

// ctrl+z / ctrl+y. Відкочується лише вміст дошки — додавання, зміна й
// видалення обʼєктів. Виділення, курсори, присутність і масштаб полотна в
// документ не пишуться взагалі, тому й повертати їх нема звідки: «скасувати»
// має повернути намальоване, а не те, куди я перед тим дивився
export function undoBoard() {
  performUndo();
  dropDeadSelection();
}

export function redoBoard() {
  performRedo();
  dropDeadSelection();
}

// відкат міг забрати обʼєкти, які лишались виділеними — трансформер і
// контекстна панель не мають триматись за те, чого вже нема
function dropDeadSelection() {
  const { selectedIds, selectMany } = useEditorStore.getState();
  const { getById } = useBoardStore.getState();
  const alive = selectedIds.filter((id) => getById(id));
  if (alive.length !== selectedIds.length) selectMany(alive);
}
