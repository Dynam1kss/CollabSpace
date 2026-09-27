import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { screenToBoard } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { placeImageFromFile } from './place-image';
import { i18n } from '../i18n';
import { errorText } from '../i18n/api-error';

// картинку можна не тільки вибрати кнопкою: кинути файл на полотно або
// вставити з буфера (скріншот). Обидва шляхи ведуть у той самий
// placeImageFromFile, що й кнопка — другого конвеєра завантаження нема
export function useImageDrop(
  boardId: string,
  currentUserId: string,
  containerRef: RefObject<HTMLDivElement | null>,
  viewport: Viewport,
) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(id);
  }, [error]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    async function place(file: File, point: { x: number; y: number }) {
      // той самий гейт, що й у решти створення: глядач нічого не додає
      if (!useEditorStore.getState().canEdit) return;
      setUploading(true);
      setError(null);
      try {
        await placeImageFromFile(boardId, file, point, currentUserId);
      } catch (err) {
        setError(errorText(err, i18n.t('board.imageFailed')));
      } finally {
        setUploading(false);
      }
    }

    // без preventDefault на dragover браузер просто відкриє файл у вкладці
    function handleDragOver(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }

    function handleDrop(e: DragEvent) {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      // кидають у конкретну точку — туди картинку й ставимо
      const point = screenToBoard({ x: e.clientX - rect.left, y: e.clientY - rect.top }, viewport);
      void place(file, point);
    }

    // у буфера координати нема, тому центр того, що зараз видно
    function handlePaste(e: ClipboardEvent) {
      if (isTypingTarget(e.target)) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const point = screenToBoard({ x: rect.width / 2, y: rect.height / 2 }, viewport);
      void place(file, point);
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

  return { uploading, error };
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
