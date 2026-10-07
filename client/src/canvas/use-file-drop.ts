import { useEffect } from 'react';
import { screenToBoard } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { placeFiles } from './place-file';

// кинути файли на полотно або вставити їх із буфера. Картинки й далі йдуть
// своїм шляхом (useImageDrop): вони стають растром на дошці, а не карткою
export function useFileDrop(
  boardId: string,
  currentUserId: string,
  containerRef: { current: HTMLDivElement | null },
  viewport: Viewport,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // картинку бере useImageDrop — тут лише решта
    const notImages = (files: File[]) => files.filter((f) => !f.type.startsWith('image/'));

    function handleDragOver(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }

    function handleDrop(e: DragEvent) {
      const files = notImages([...(e.dataTransfer?.files ?? [])]);
      if (files.length === 0) return;
      e.preventDefault();
      if (!useEditorStore.getState().canEdit) return;
      const rect = el!.getBoundingClientRect();
      const point = screenToBoard({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport);
      void placeFiles(boardId, files, point, currentUserId);
    }

    function handlePaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return;
      const files = notImages([...(e.clipboardData?.files ?? [])]);
      if (files.length === 0) return;
      e.preventDefault();
      if (!useEditorStore.getState().canEdit) return;
      // у буфера координат немає — кладемо посеред видимого
      const rect = el!.getBoundingClientRect();
      const point = screenToBoard({ x: rect.width / 2, y: rect.height / 2 }, viewport);
      void placeFiles(boardId, files, point, currentUserId);
    }

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);
    return () => {
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, [boardId, currentUserId, containerRef, viewport]);
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
