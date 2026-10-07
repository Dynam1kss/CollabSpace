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
      reject(new UploadError(codeFrom(xhr)));
    });
    xhr.addEventListener('error', () => reject(new UploadError('network')));
    xhr.addEventListener('abort', () => reject(new UploadError('cancelled')));
    xhr.send(file);
  });
  return { done, cancel: () => xhr.abort() };
}

export type UploadErrorCode = 'too-large' | 'forbidden' | 'rate' | 'network' | 'cancelled' | 'unknown';

export class UploadError extends Error {
  constructor(public code: UploadErrorCode) {
    super(code);
  }
}

function codeFrom(xhr: XMLHttpRequest): UploadErrorCode {
  if (xhr.status === 413) return 'too-large';
  if (xhr.status === 403) return 'forbidden';
  if (xhr.status === 429) return 'rate';
  return 'unknown';
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
