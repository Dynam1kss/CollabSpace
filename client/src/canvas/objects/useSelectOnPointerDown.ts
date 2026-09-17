import { useCallback } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEditorStore } from '../editor-store';

// кожен інтерактивний обʼєкт ставить cancelBubble на власному mousedown/touchstart —
// інакше дотик по стікеру одночасно й тягатиме його, і паруватиме/зумитиме полотно,
// бо та сама подія дійшла б і до обробників Stage
export function useSelectOnPointerDown(objectId: string) {
  return useCallback(
    (e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent>) => {
      const evt = e.evt;
      // права/середня кнопка — не виділення, а пан: пускаємо подію далі до Stage,
      // де useCanvasViewport її й підхопить (konva сама не тягне обʼєкт не лівою)
      if ('button' in evt && evt.button !== 0) return;

      e.cancelBubble = true;
      const shiftKey = 'shiftKey' in evt && evt.shiftKey;
      const { selectedIds, select, toggleSelect } = useEditorStore.getState();
      if (shiftKey) {
        toggleSelect(objectId);
      } else if (!selectedIds.includes(objectId)) {
        select(objectId);
      }
    },
    [objectId],
  );
}
