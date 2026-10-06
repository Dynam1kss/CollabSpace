import { parseLinkUrl } from './links';
import type { LinkKind } from './links';

export interface BoardObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  createdBy: string;
  createdAt: string;
  // чи можна ставити на цей обʼєкт голосові стільці. Зазвичай стілець
  // обходить обʼєкти стороною, але для намальованого дивана чи столу це
  // якраз заважає. Ставить власник або адміністратор; старі снепшоти поля
  // не мають — там це просто false
  seatsAllowed?: boolean;
  // захист від випадкового зсуву: замкнений обʼєкт не тягається, не
  // міняє розміру й не видаляється, але виділяти його можна — інакше
  // нізвідки взяти саму кнопку «відімкнути». Ставить будь-хто, крім
  // глядача; старі снепшоти поля не мають — там це false
  locked?: boolean;
}

// горизонтальне вирівнювання тексту. Поле необовʼязкове: усе, намальоване до
// 06.10, вирівняне вліво, і дописувати їм це в базу нема потреби
export type TextAlign = 'left' | 'center' | 'right';

export function textAlign(object: { align?: TextAlign }): TextAlign {
  return object.align ?? 'left';
}

export type StickyColumn = 'todo' | 'in-progress' | 'done';

// column — колонка канбан-подання; null — стікер поза дошкою задач, на
// полотні він нічим не відрізняється. старі снепшоти поля не мають взагалі
export interface StickyObject extends BoardObjectBase {
  type: 'sticky';
  text: string;
  fillColor: string;
  textColor: string;
  column: StickyColumn | null;
  // необовʼязковий, як seatsAllowed: до 06.10 розмір був прибитий у коді, і
  // старі стікери поля не мають — у них читається STICKY_FONT_SIZE, тобто
  // рівно те, чим вони й малювались
  fontSize?: number;
  align?: TextAlign;
}

// розмір тексту стікера, яким він був до появи самого поля. Міняти не можна:
// на це число спираються всі дошки, збережені раніше
export const STICKY_FONT_SIZE = 16;

export function stickyFontSize(object: Pick<StickyObject, 'fontSize'>) {
  return object.fontSize ?? STICKY_FONT_SIZE;
}

// autoWidth — ширина ще ніким не задана: блок росте вшир за текстом без
// переносу; після першого тягання бокового ребра стає false і width — межа,
// по якій переносяться слова. height завжди похідна від вмісту (текст не
// обрізається ніколи), minHeight — нижня межа, яку ставить нижнє ребро
export interface TextObject extends BoardObjectBase {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  autoWidth: boolean;
  minHeight: number;
  align?: TextAlign;
}

export type ShapeKind = 'rect' | 'ellipse';

export interface ShapeObject extends BoardObjectBase {
  type: 'shape';
  shapeKind: ShapeKind;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

// points — впорядковані основні точки лінії (мінімум 2), крива через них
// малюється сплайном. x/y/width/height — bounding box по всіх точках (для
// виділення й уніфікованого hit-теста поруч з іншими типами). Тримати їх
// узгодженими — відповідальність коду, що змінює обʼєкт
export interface ConnectorObject extends BoardObjectBase {
  type: 'connector';
  points: BoardPoint[];
  strokeColor: string;
  strokeWidth: number;
  arrowEnd: boolean;
}

// штрих лінії: суцільний, штриховий, крапковий. Поле необовʼязкове — лінія
// без нього суцільна
export type LineDash = 'solid' | 'dashed' | 'dotted';

// пряма між двома точками. Окремий тип, а не конектор із двома точками: у
// конектора points — це ламана, яку konva веде сплайном, з вставними
// середніми точками й натягом. Прямій усе це не потрібне, а наслідувати
// довелось би разом із помилками. Тут рівно два кінці.
// x/y/width/height — рамка по цих двох точках (виділення, hit-тест, клітинка
// в стратегії 3); тримати їх узгодженими — справа коду, що міняє лінію
export interface LineObject extends BoardObjectBase {
  type: 'line';
  from: BoardPoint;
  to: BoardPoint;
  strokeColor: string;
  strokeWidth: number;
  dash?: LineDash;
  // вістря на кінцях. Необовʼязкові, бо найчастіша лінія — без них
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export function lineDash(object: Pick<LineObject, 'dash'>): LineDash {
  return object.dash ?? 'solid';
}

// url — відносний шлях /uploads/..., сам файл лежить на диску сервера
export interface ImageObject extends BoardObjectBase {
  type: 'image';
  url: string;
  // віддзеркалення вмісту. Необовʼязкові, як seatsAllowed: старі знімки їх
  // просто не мають, і це читається як false. На x/y/width/height не
  // впливають — це суто про те, як намальовано растр
  flipX?: boolean;
  flipY?: boolean;
}

// картка-посилання. kind і videoId лежать в обʼєкті (так їх видно в знімку й
// перевіряє zod), але читати їх треба ТІЛЬКИ через linkKind/linkVideoId нижче
export interface LinkObject extends BoardObjectBase {
  type: 'link';
  url: string;
  // свій підпис; без нього картка показує домен
  title?: string;
  kind?: LinkKind;
  videoId?: string;
}

// джерело правди — лише url, збережені поля тут навмисно не читаються. Інакше
// обʼєкт із чужою адресою й дописаним videoId малювався б карткою youtube і
// крутив у iframe зовсім інше відео, ніж відкриває «відкрити»
export function linkKind(object: Pick<LinkObject, 'url'>): LinkKind {
  return parseLinkUrl(object.url)?.kind ?? 'web';
}

export function linkVideoId(object: Pick<LinkObject, 'url'>): string | undefined {
  return parseLinkUrl(object.url)?.videoId;
}

export type BoardObject =
  | StickyObject
  | TextObject
  | ShapeObject
  | ConnectorObject
  | LineObject
  | ImageObject
  | LinkObject;
export type BoardObjectType = BoardObject['type'];
