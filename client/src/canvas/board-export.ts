import type { BoardObject } from 'shared';
import type { Bounds } from './fit-to-objects';

// відступ навколо вмісту в одиницях дошки: обведення й стрілки конекторів
// виходять за x/y/width/height, без запасу їх обрізало б по краю
export const EXPORT_PADDING = 40;
const EXPORT_PIXEL_RATIO = 2;
// більше мобільний сафарі канвас не виділить (4096²) — віддасть порожній.
// хром тягне більше, але pwa має працювати й на айфоні
const MAX_CANVAS_AREA = 16_777_216;
const MAX_CANVAS_SIDE = 16_384;
// 200 дюймів — більшу сторінку acrobat не відкриває
const PDF_MAX_SIDE_PT = 14_400;

export interface ExportFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
}

// прямокутник дошки, який іде в файл, і скільки пікселів на одиницю дошки.
// велика дошка отримує менший pixelRatio, а не обрізається
export function exportFrame(bounds: Bounds): ExportFrame {
  const width = Math.max(1, bounds.maxX - bounds.minX) + EXPORT_PADDING * 2;
  const height = Math.max(1, bounds.maxY - bounds.minY) + EXPORT_PADDING * 2;
  const pixelRatio = Math.min(
    EXPORT_PIXEL_RATIO,
    MAX_CANVAS_SIDE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
  );
  return { x: bounds.minX - EXPORT_PADDING, y: bounds.minY - EXPORT_PADDING, width, height, pixelRatio };
}

// що йде у файл: виділене, якщо воно є, інакше вся дошка. id, яких уже нема
// (обʼєкт видалили, поки він був виділений), відкидаємо — і якщо не лишилось
// нічого, це знову вся дошка, а не порожній файл
export function exportTargets(objects: Record<string, BoardObject>, selectedIds: string[]) {
  const selected = selectedIds.map((id) => objects[id]).filter((o): o is BoardObject => !!o);
  if (selected.length > 0) return { objects: selected, onlySelected: true };
  return { objects: Object.values(objects), onlySelected: false };
}

// одиниця дошки = 1pt, завелике зменшуємо зі збереженням пропорцій
export function pdfPageSize(width: number, height: number) {
  const k = Math.min(1, PDF_MAX_SIDE_PT / Math.max(width, height));
  return { width: width * k, height: height * k };
}

// у назві дошки може бути що завгодно, а windows не приймає \/:*?"<>| і
// керуючі символи; пробіли міняємо на дефіс, щоб файл не розвалювався в терміналі
export function exportFileName(title: string, date: Date, ext: 'png' | 'pdf') {
  const base = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^[.-]+|[.-]+$/g, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${base || 'дошка'}-${day}.${ext}`;
}
