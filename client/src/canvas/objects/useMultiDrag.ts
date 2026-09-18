import { useCallback } from 'react';
import type { BoardObject } from 'shared';
import { useEditorStore } from '../editor-store';
import { withPoints } from './connector-geometry';

export function moveByDelta(obj: BoardObject, dx: number, dy: number) {
  if (obj.type === 'connector') {
    return withPoints(obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  }
  return { x: obj.x + dx, y: obj.y + dy };
}

// поки жест іде, контекстна панель ховається, а SelectionOverlay не перечіпляє
// nodes() трансформера — оце й усе, що тут лишилось.
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
