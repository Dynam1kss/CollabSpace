import { createId } from '@paralleldrive/cuid2';
import type { FileObject } from 'shared';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { FILE_BASE_WIDTH, fileCardSize } from './file-layout';
import { serverLimits, UploadError, uploadBoardFile } from './file-upload';
import { FILE_ERROR } from 'shared';
import { nextZIndex } from './selection-actions';
import { holdUploadedFile } from './file-holds';
import { useUploadStore } from './upload-store';
import { humanSize } from './file-layout';
import { i18n } from '../i18n';
import type { Point } from './coordinates';

// кілька файлів лягають рядком від точки кидання — інакше вони б накрились
// один одним і довелось би розтягувати їх руками
const GAP = 16;

export function rowPoints(start: Point, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => ({
    x: start.x + i * (FILE_BASE_WIDTH + GAP),
    y: start.y,
  }));
}

function messageFor(error: unknown, limit: number) {
  if (!(error instanceof UploadError)) return i18n.t('file.failed');
  if (error.code === 'cancelled') return i18n.t('file.cancelled');
  if (error.code === 'network' || error.code === 'unknown') return i18n.t('file.failed');
  // серверний рядок не показуємо ніколи — лише свій текст за кодом. Для квоти
  // в тексті мусять бути числа, тому вони приїжджають у тілі помилки
  if (error.code === FILE_ERROR.quota) {
    return i18n.t(`errors.${FILE_ERROR.quota}`, {
      used: humanSize(error.usedBytes ?? 0),
      total: humanSize(error.totalBytes ?? limit),
    });
  }
  if (error.code === FILE_ERROR.tooLarge) {
    return i18n.t(`errors.${FILE_ERROR.tooLarge}`, { limit: humanSize(limit) });
  }
  return i18n.exists(`errors.${error.code}`) ? i18n.t(`errors.${error.code}`) : i18n.t('file.failed');
}

// один файл: заготовка з ходом, потім справжня картка. Повертає id картки або
// null, якщо не вийшло
async function placeOne(boardId: string, file: File, point: Point, createdBy: string) {
  const { fileMaxBytes } = await serverLimits();
  // перевіряємо ДО завантаження: немає сенсу гнати 200 МБ, щоб отримати 413
  if (file.size > fileMaxBytes) {
    const id = useUploadStore.getState().add({ name: file.name, size: file.size, ...point, cancel: () => {} });
    useUploadStore
      .getState()
      .fail(id, i18n.t(`errors.${FILE_ERROR.tooLarge}`, { limit: humanSize(fileMaxBytes) }));
    return null;
  }

  let handle: { cancel: () => void } = { cancel: () => {} };
  const pendingId = useUploadStore.getState().add({
    name: file.name,
    size: file.size,
    ...point,
    cancel: () => handle.cancel(),
  });

  try {
    const upload = uploadBoardFile(boardId, file, (fraction) =>
      useUploadStore.getState().setProgress(pendingId, fraction),
    );
    handle = upload;
    const info = await upload.done;
    // тримаємо до моменту, коли картка опиниться в знімку; сервер і сам
    // тримає його коротко, це лише узгоджує обидва боки
    holdUploadedFile(info.id);

    const object: FileObject = {
      id: createId(),
      type: 'file',
      x: point.x,
      y: point.y,
      width: FILE_BASE_WIDTH,
      height: 0,
      rotation: 0,
      zIndex: nextZIndex(),
      createdBy,
      createdAt: new Date().toISOString(),
      fileId: info.id,
      name: info.name,
      size: info.size,
      mime: info.mime,
    };
    const sized = { ...object, ...fileCardSize(object) };
    useBoardStore.getState().add(sized);
    useUploadStore.getState().remove(pendingId);
    return sized.id;
  } catch (error) {
    useUploadStore.getState().fail(pendingId, messageFor(error, fileMaxBytes));
    return null;
  }
}

// кілька файлів підряд: завантажуємо послідовно, щоб не забивати канал і щоб
// порядок карток у рядку збігався з порядком файлів
export async function placeFiles(boardId: string, files: File[], start: Point, createdBy: string) {
  if (!useEditorStore.getState().canEdit) return;
  const points = rowPoints(start, files.length);
  const created: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const id = await placeOne(boardId, files[i], points[i], createdBy);
    if (id) created.push(id);
  }
  if (created.length > 0) useEditorStore.getState().selectMany(created);
}
