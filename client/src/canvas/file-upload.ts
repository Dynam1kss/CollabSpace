import { FILE_ERROR } from 'shared';
import type { BoardFileInfo } from 'shared';

// XMLHttpRequest, а не fetch: лише він дає ХІД завантаження. fetch уміє
// стежити за відповіддю, але не за тим, скільки вже відправлено, а картка має
// показувати справжній відсоток, а не крутилку
export interface UploadHandle {
  done: Promise<BoardFileInfo>;
  cancel: () => void;
}

export function uploadBoardFile(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const done = new Promise<BoardFileInfo>((resolve, reject) => {
    xhr.open('POST', `/api/boards/${boardId}/files`);
    // тіло — сам файл, без обгорток; назва їде заголовком, бо в заголовок
    // можна класти лише ascii
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as BoardFileInfo);
        } catch {
          reject(new UploadError('unknown'));
        }
        return;
      }
      reject(errorFrom(xhr));
    });
    xhr.addEventListener('error', () => reject(new UploadError('network')));
    xhr.addEventListener('abort', () => reject(new UploadError('cancelled')));
    xhr.send(file);
  });
  return { done, cancel: () => xhr.abort() };
}

// код приходить із сервера як є (shared/FILE_ERROR) — щоб «завеликий файл» і
// «скінчилось місце» ніколи не злились в одне повідомлення
export class UploadError extends Error {
  constructor(
    public code: string,
    public usedBytes?: number,
    public totalBytes?: number,
  ) {
    super(code);
  }
}

function errorFrom(xhr: XMLHttpRequest): UploadError {
  try {
    const body = JSON.parse(xhr.responseText) as {
      error?: { code?: string; usedBytes?: number; totalBytes?: number };
    };
    if (body.error?.code) {
      return new UploadError(body.error.code, body.error.usedBytes, body.error.totalBytes);
    }
  } catch {
    // тіло не json — лишається загальний код нижче
  }
  return new UploadError(xhr.status === 403 ? FILE_ERROR.forbidden : 'unknown');
}

// межі сервер оголошує в /api/health; питаємо один раз на вкладку й
// запамʼятовуємо — числа не міняються без перезапуску сервера
let limits: Promise<{ fileMaxBytes: number; boardFilesMaxBytes: number }> | null = null;

export function serverLimits() {
  limits ??= fetch('/api/health')
    .then((r) => r.json() as Promise<{ limits: { fileMaxBytes: number; boardFilesMaxBytes: number } }>)
    .then((body) => body.limits)
    .catch(() => ({ fileMaxBytes: Number.POSITIVE_INFINITY, boardFilesMaxBytes: Number.POSITIVE_INFINITY }));
  return limits;
}
