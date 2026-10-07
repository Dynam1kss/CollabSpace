// файли, прикріплені до дошки. Тип у shared, бо його читають і клієнт, і
// сервер: клієнт малює картку, сервер віддає метадані після завантаження

export interface BoardFileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  // скільки всього зайнято дошкою після цього завантаження — щоб клієнт
  // одразу знав, скільки лишилось, і не питав окремо
  boardUsedBytes: number;
}

// назва від людини — найнебезпечніший рядок у всій цій історії: вона потрапляє
// в заголовок відповіді й на екран. Розділювачі шляху, керівні символи та
// перевизначення напрямку письма (ними ховають справжнє розширення:
// «photo‮gnp.exe») прибираємо завжди
const BIDI = /[‪-‮⁦-⁩‎‏]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
export const FILE_NAME_MAX = 120;

export function sanitizeFileName(raw: string): string {
  const cleaned = raw
    .replace(BIDI, '')
    .replace(CONTROL, '')
    .replace(/[\\/]/g, '_')
    // крапки на початку ховають файл у unix, а «..» — спроба вийти вгору
    .replace(/^\.+/, '')
    .trim();
  if (cleaned === '') return 'file';
  if (cleaned.length <= FILE_NAME_MAX) return cleaned;
  // обрізаємо середину, щоб лишилось розширення: воно й показує тип
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, FILE_NAME_MAX - ext.length) + ext;
}

// що БЕЗПЕЧНО показувати просто у вкладці. Усе, чого тут немає, віддається
// вкладенням. svg і html сюди не потраплять ніколи: обидва вміють виконувати
// скрипти в нашому походженні
const INLINE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'text/plain',
]);

export function isInlineMime(mime: string) {
  return INLINE_MIME.has(mime);
}

// різновид для іконки картки. Рахується з mime, а не з назви: назву вигадує людина
export type FileKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'archive' | 'other';

export function fileKind(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/zip' || mime === 'application/x-7z-compressed' || mime === 'application/gzip') {
    return 'archive';
  }
  return 'other';
}

// скільки зʼєднання тримає щойно завантажений файл, якому ще не поставили
// картку. Це не «пільга на квоту», а резерв: місце зайняте й видно всім
export const FILE_UPLOAD_HOLD_MS = 2 * 60 * 1000;

// коди відмов. Машинні — щоб клієнт показав свій текст, а не серверний рядок,
// і щоб «завеликий файл» ніколи не плутався з «скінчилось місце»
export const FILE_ERROR = {
  tooLarge: 'FILE_TOO_LARGE',
  quota: 'BOARD_QUOTA_EXCEEDED',
  // сервер поки не обмежує типи — код є, щоб клієнт був готовий
  type: 'FILE_TYPE_NOT_ALLOWED',
  rate: 'FILE_RATE_LIMITED',
  forbidden: 'FILE_FORBIDDEN',
} as const;

export interface BoardFilesUsage {
  usedBytes: number;
  storedBytes: number;
  quotaBytes: number;
  fileMaxBytes: number;
}
