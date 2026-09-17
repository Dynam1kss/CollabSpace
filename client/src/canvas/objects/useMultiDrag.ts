import { useCallback, useRef } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BoardObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { withPoints } from './connector-geometry';

export function moveByDelta(obj: BoardObject, dx: number, dy: number) {
  if (obj.type === 'connector') {
    return withPoints(obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
  }
  return { x: obj.x + dx, y: obj.y + dy };
}

// перетягування одного обʼєкта з групи виділених рухає всю групу на той самий
// зсув — інші обʼєкти оновлюються в сторі безпосередньо, а вузол під курсором
// Konva рухає сам (draggable), його власну позицію фіксуємо окремо на dragend.
// Konva Transformer до того ж сам тягне решту своїх вузлів за першим — для
// фігур це збігається зі сторовим шляхом, а конектор зі стору не рухаємо:
// його вузол їде за трансформером, і власний dragend уже запікає зсув у точки
export function useMultiDragDelta(objectId: string) {
  const siblingsStart = useRef<Record<string, BoardObject>>({});
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const onDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      dragStart.current = { x: e.target.x(), y: e.target.y() };
      const { selectedIds, setInteracting } = useEditorStore.getState();
      setInteracting(true);
      const { getById } = useBoardStore.getState();
      const snapshot: Record<string, BoardObject> = {};
      if (selectedIds.length > 1 && selectedIds.includes(objectId)) {
        for (const id of selectedIds) {
          if (id === objectId) continue;
          const obj = getById(id);
          if (obj && obj.type !== 'connector') snapshot[id] = obj;
        }
      }
      siblingsStart.current = snapshot;
    },
    [objectId],
  );

  const applyToSiblings = useCallback((e: KonvaEventObject<DragEvent>) => {
    if (!dragStart.current) return;
    const dx = e.target.x() - dragStart.current.x;
    const dy = e.target.y() - dragStart.current.y;
    if (dx === 0 && dy === 0) return;
    const { update } = useBoardStore.getState();
    for (const [id, obj] of Object.entries(siblingsStart.current)) {
      update(id, moveByDelta(obj, dx, dy));
    }
  }, []);

  const onDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      applyToSiblings(e);
      dragStart.current = null;
      siblingsStart.current = {};
      useEditorStore.getState().setInteracting(false);
    },
    [applyToSiblings],
  );

  return { onDragStart, onDragMove: applyToSiblings, onDragEnd };
}
