import { fileKind } from 'shared';
import type { FileObject } from 'shared';

// картка файла будується так само, як картка посилання: уся розкладка в
// БАЗОВІЙ ширині, а на дошці масштабується цілком. Окремий модуль, бо вміст
// інший — значок типу, назва й розмір, без картинки й домену
export const FILE_BASE_WIDTH = 240;
export const FILE_PAD = 12;
export const FILE_ICON = 28;
const NAME_SIZE = 14;
const META_SIZE = 12;
const LINE = 1.2;
const GAP = 4;
// скільки рядків назви показуємо, далі — трикрапка
const NAME_LINES = 2;

export interface FileLayout {
  textX: number;
  textWidth: number;
  nameY: number;
  nameHeight: number;
  metaY: number;
  height: number;
  name: string;
  meta: string;
  nameSize: number;
  metaSize: number;
}

// розмір у звичних одиницях. Кілобайт тут 1024 — так його рахує і провідник,
// і сам сервер у своїх межах
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function fileLayout(object: Pick<FileObject, 'name' | 'size' | 'mime'>): FileLayout {
  const textX = FILE_PAD + FILE_ICON + 10;
  const textWidth = FILE_BASE_WIDTH - textX - FILE_PAD;
  // назва переноситься, але не довше ніж NAME_LINES рядків — далі трикрапка,
  // інакше одна довга назва розтягнула б картку на пів екрана
  const nameHeight = Math.round(NAME_SIZE * LINE * NAME_LINES);
  const nameY = FILE_PAD;
  const metaY = nameY + nameHeight + GAP;
  return {
    textX,
    textWidth,
    nameY,
    nameHeight,
    metaY,
    height: Math.round(metaY + META_SIZE * LINE + FILE_PAD),
    name: object.name,
    meta: `${humanSize(object.size)} · ${kindLabel(object.mime)}`,
    nameSize: NAME_SIZE,
    metaSize: META_SIZE,
  };
}

// короткий підпис типу поруч із розміром
function kindLabel(mime: string) {
  switch (fileKind(mime)) {
    case 'image':
      return 'зображення';
    case 'pdf':
      return 'PDF';
    case 'video':
      return 'відео';
    case 'audio':
      return 'аудіо';
    case 'text':
      return 'текст';
    case 'archive':
      return 'архів';
    default:
      return 'файл';
  }
}

export function fileCardSize(object: Pick<FileObject, 'name' | 'size' | 'mime'>, width = FILE_BASE_WIDTH) {
  const scale = width / FILE_BASE_WIDTH;
  return { width: Math.round(width), height: Math.round(fileLayout(object).height * scale) };
}

// адресу файла збирає клієнт: у обʼєкті лежить лише id, бо дошка в адресі
// однакова для всіх його карток
export function fileUrl(boardId: string, fileId: string) {
  return `/api/boards/${boardId}/files/${fileId}`;
}
