import { linkDomain, linkKind, linkVertical } from 'shared';
import type { LinkObject } from 'shared';

// розкладка картки посилання. Вся картка малюється в координатах БАЗОВОЇ
// ширини, а на дошці масштабується цілком (scale = width / BASE): так
// картинка, іконка й текст ростуть разом, одним числом, і не треба
// перераховувати кожен шрифт окремо
export const LINK_BASE_WIDTH = 260;

export const LINK_PAD = 12;
export const LINK_ICON = 22;
// значок «відкрити» в правому верхньому куті картки
export const LINK_BADGE = 18;
export const LINK_FONT = 'Arial, Helvetica, sans-serif';
const TITLE_SIZE = 15;
const TEXT_SIZE = 12;
const LINE_HEIGHT = 1.2;
const GAP = 4;

// ширина, поділена на висоту: 16:9 для звичайного відео, 9:16 для shorts
const WIDE = 16 / 9;
const TALL = 9 / 16;

export interface LinkLayout {
  // усе нижче — в координатах базової ширини
  imageHeight: number;
  textX: number;
  textWidth: number;
  titleY: number;
  titleHeight: number;
  descY: number;
  descHeight: number;
  domainY: number;
  height: number;
  title: string;
  description: string;
  domain: string;
  titleSize: number;
  textSize: number;
  // іконка замість картинки — лише у звичайної картки без прев'ю
  withIcon: boolean;
}

// міряємо тим самим konva, яким і малюємо, — інакше рамка розійдеться з
// текстом. Беремо її з window, а не імпортом: у vitest середовище node, і
// `import 'konva'` там падає на відсутньому модулі canvas, а цей модуль
// тягнуть і object-defaults, і тести
interface Measurer {
  setAttrs: (attrs: Record<string, unknown>) => void;
  height: () => number;
}
let measurer: Measurer | null = null;

function measure(text: string, fontSize: number, width: number, bold: boolean) {
  if (text === '') return 0;
  const Konva = (globalThis as { Konva?: { Text: new (config: unknown) => Measurer } }).Konva;
  if (Konva) {
    measurer ??= new Konva.Text({ fontFamily: LINK_FONT, lineHeight: LINE_HEIGHT });
    measurer.setAttrs({ text, fontSize, width, wrap: 'word', fontStyle: bold ? 'bold' : 'normal' });
    return measurer.height();
  }
  // без konva (тести) — грубий рахунок рядків: сюди потрапляє лише код, що
  // не малює, тож точність тут ні на що не впливає
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.52)));
  const lines = text
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(part.length / perLine)), 0);
  return Math.round(lines * fontSize * LINE_HEIGHT);
}

export function linkAspect(object: Pick<LinkObject, 'url'>): number {
  return linkVertical(object) ? TALL : WIDE;
}

// картинка картки: мініатюра відео або завантажене прев'ю. null — картинки
// немає, тоді ліворуч від підпису малюється іконка ланцюжка
export function linkImageAspect(object: LinkObject): number | null {
  if (linkKind(object) === 'youtube') return linkAspect(object);
  if (!object.previewImage) return null;
  return object.previewAspect && object.previewAspect > 0 ? object.previewAspect : WIDE;
}

export function linkLayout(object: LinkObject): LinkLayout {
  const domain = linkDomain(object.url);
  // свій підпис завжди перебиває витягнутий зі сторінки
  const title = (object.title ?? object.previewTitle ?? '').trim() || domain;
  const description = (object.previewDescription ?? '').trim();
  const aspect = linkImageAspect(object);
  const imageHeight = aspect === null ? 0 : Math.round(LINK_BASE_WIDTH / aspect);
  const withIcon = aspect === null;

  const textX = withIcon ? LINK_PAD + LINK_ICON + 10 : LINK_PAD;
  // у картки без картинки значок «відкрити» стоїть у тому ж рядку, що й
  // підпис, — лишаємо йому місце, інакше довга назва заповзає під нього
  const reserved = withIcon ? LINK_BADGE + 6 : 0;
  const textWidth = LINK_BASE_WIDTH - textX - LINK_PAD - reserved;

  const titleY = imageHeight + LINK_PAD;
  const titleHeight = measure(title, TITLE_SIZE, textWidth, true);
  const descY = titleY + titleHeight + (description ? GAP : 0);
  const descHeight = measure(description, TEXT_SIZE, textWidth, false);
  const domainY = descY + descHeight + GAP;
  const domainHeight = measure(domain, TEXT_SIZE, textWidth, false);

  return {
    imageHeight,
    textX,
    textWidth,
    titleY,
    titleHeight,
    descY,
    descHeight,
    domainY,
    height: Math.round(domainY + domainHeight + LINK_PAD),
    title,
    description,
    domain,
    titleSize: TITLE_SIZE,
    textSize: TEXT_SIZE,
    withIcon,
  };
}

// розмір картки на дошці: ширину задає людина, висота — похідна від вмісту
// при базовій ширині, помножена на той самий масштаб
export function linkCardSize(object: LinkObject, width = object.width) {
  const scale = width / LINK_BASE_WIDTH;
  return { width: Math.round(width), height: Math.round(linkLayout(object).height * scale) };
}

// будь-яка правка картки міняє і її висоту: вона похідна від вмісту. Щоб про
// це не забували на кожному місці правки, патч завжди йде через цю функцію
export function linkPatchWithSize(object: LinkObject, patch: Partial<LinkObject>) {
  const next = { ...object, ...patch } as LinkObject;
  return { ...patch, ...linkCardSize(next) };
}
