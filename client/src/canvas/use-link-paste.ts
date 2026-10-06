import { useEffect } from 'react';
import { parseLinkUrl } from 'shared';
import { useBoardStore } from './board-store';
import { screenToBoard } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { loadLinkPreview } from './link-preview';
import { createLink } from './object-defaults';
import { nextZIndex } from './selection-actions';

// вставлена з буфера адреса стає карткою посилання. Окремо від useImageDrop:
// там у буфері файл, тут рядок, і спільного між ними лише слово «вставити»
export function useLinkPaste(
  boardId: string,
  currentUserId: string,
  containerRef: { current: HTMLDivElement | null },
  viewport: Viewport,
) {
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      // набирають текст — вставка належить полю, не дошці
      if (isTypingTarget(e.target)) return;
      if (!useEditorStore.getState().canEdit) return;
      // картинку з буфера бере useImageDrop; тут лише рядок
      if ([...(e.clipboardData?.items ?? [])].some((i) => i.type.startsWith('image/'))) return;
      // свої скопійовані обʼєкти вставляє ctrl+v редактора — не перебиваємо
      if (useEditorStore.getState().clipboard.length > 0) return;
      const parsed = parseLinkUrl(e.clipboardData?.getData('text/plain') ?? '');
      if (!parsed) return;
      const el = containerRef.current;
      if (!el) return;
      e.preventDefault();
      // у буфера координат немає — ставимо посеред того, що видно
      const rect = el.getBoundingClientRect();
      const point = screenToBoard({ x: rect.width / 2, y: rect.height / 2 }, viewport);
      const object = createLink(point, parsed, { createdBy: currentUserId, zIndex: nextZIndex() });
      useBoardStore.getState().add(object);
      useEditorStore.getState().select(object.id);
      void loadLinkPreview(boardId, object.id);
    }

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [boardId, currentUserId, containerRef, viewport]);
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
