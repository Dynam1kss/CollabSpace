import { useCallback } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import { useEditorStore } from '../editor-store';

// кожен інтерактивний обʼєкт ставить cancelBubble на власному mousedown/touchstart —
// інакше дотик по стікеру одночасно й тягатиме його, і паруватиме/зумитиме полотно,
// бо та сама подія дійшла б і до обробників Stage
export function useSelectOnPointerDown(objectId: string) {
  return useCallback(
    (e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent>) => {
      e.cancelBubble = true;
      const evt = e.evt as MouseEvent;
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
