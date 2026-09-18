import { useCallback } from 'react';
import { useEditorStore } from '../editor-store';

// поки жест іде, контекстна панель ховається, а SelectionOverlay не перечіпляє
// nodes() трансформера — оце й усе, що тут треба.
// Решту виділених звідси не рухаємо: трансформер сам тягне всі свої вузли за
// тим, який узяли (_proxyDrag), і кожен пише свою позицію в стор сам. Тут колись
// був ще знімок сусідів і зсув від нього — знімок зі стору, зсув із вузла.
// Сходилось це лише поки стор писався синхронно щокадру; щойно записи згорнулись
// у пакет на кадр, вузол, чий dragstart konva будить на кадр пізніше, почав
// рахувати сусідам зсув від застарілої бази і затирати їм правильну позицію
export function useDragGesture() {
  const onDragStart = useCallback(() => useEditorStore.getState().setInteracting(true), []);
  const onDragEnd = useCallback(() => useEditorStore.getState().setInteracting(false), []);
  return { onDragStart, onDragEnd };
}
