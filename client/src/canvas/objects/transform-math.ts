import type { Point } from '../coordinates';
import { MIN_SIZE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from '../limits';

export { MIN_SIZE };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// Усе, що потрібно знати про жест, береться ОДИН раз — на його початку — і
// далі не міняється. Щокадру лишається чиста функція від двох речей: цього
// запису й того, де зараз курсор. Ні попередній кадр, ні рамка від konva, ні
// scale вузла в рахунок не входять узагалі — тому й накопичувати нема чого
export interface ResizeGrip {
  // нерухома точка в координатах дошки: кут (або край) НАПРОТИ взятої ручки
  x: number;
  y: number;
  // у який бік від неї дивиться ручка, поки фігуру не перевернули
  signX: 1 | -1;
  signY: 1 | -1;
  // ребром тягнуть лише одну вісь, друга не міняється зовсім
  drivesX: boolean;
  drivesY: boolean;
  startWidth: number;
  startHeight: number;
  rotation: number;
}

// нерухома точка для кожної з восьми ручок — та, що напроти. Правило одне на
// всі: ліву ручку тягнемо — нерухомий правий край, верхню — нижній, і навпаки.
// Ручка без сторони по осі (наприклад «середина праворуч» по вертикалі) цю
// вісь не чіпає зовсім
export function gripFor(rect: Rect, rotation: number, handle: string): ResizeGrip {
  const left = handle.includes('left');
  const right = handle.includes('right');
  const top = handle.includes('top');
  const bottom = handle.includes('bottom');
  return {
    x: left ? rect.x + rect.width : rect.x,
    y: top ? rect.y + rect.height : rect.y,
    signX: left ? -1 : 1,
    signY: top ? -1 : 1,
    drivesX: left || right,
    drivesY: top || bottom,
    startWidth: rect.width,
    startHeight: rect.height,
    rotation,
  };
}

// точка самої ручки — потрібна лише щоб запамʼятати, на скільки курсор
// схибив повз неї на натисканні, і далі цю поправку віднімати
export function handlePoint(rect: Rect, handle: string): Point {
  const left = handle.includes('left');
  const right = handle.includes('right');
  const top = handle.includes('top');
  const bottom = handle.includes('bottom');
  return {
    x: left ? rect.x : right ? rect.x + rect.width : rect.x + rect.width / 2,
    y: top ? rect.y : bottom ? rect.y + rect.height : rect.y + rect.height / 2,
  };
}

export interface ResizeResult extends Rect {
  mirroredX: boolean;
  mirroredY: boolean;
}

function rotateAround(p: Point, pivot: Point, angle: number): Point {
  if (!angle) return p;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

// серце всього: нова рамка з нерухомої точки й поточного курсора
export function resizeFromPointer(grip: ResizeGrip, pointer: Point, lockRatio: boolean): ResizeResult {
  const rad = (grip.rotation * Math.PI) / 180;
  // рахуємо у власних осях обʼєкта, тому курсор довертаємо назад навколо
  // нерухомої точки; наприкінці кут повертаємо на місце
  const local = rotateAround(pointer, grip, -rad);

  // відстань від нерухомої точки до курсора ЗІ ЗНАКОМ. Вісь, яку ця ручка не
  // тягне, підставляє свій початковий розмір і лишається як була
  const rawW = grip.drivesX ? local.x - grip.x : grip.signX * grip.startWidth;
  const rawH = grip.drivesY ? local.y - grip.y : grip.signY * grip.startHeight;

  let width: number;
  let height: number;
  if (lockRatio) {
    // один множник на обидві осі — і в тому числі на порозі. Тому відношення
    // сторін не може поїхати ніяк: воно просто не бере участі в рахунку
    const scale = Math.max(
      Math.abs(rawW) / grip.startWidth,
      Math.abs(rawH) / grip.startHeight,
      MIN_SIZE / grip.startWidth,
      MIN_SIZE / grip.startHeight,
    );
    width = grip.startWidth * scale;
    height = grip.startHeight * scale;
  } else {
    width = Math.max(MIN_SIZE, Math.abs(rawW));
    height = Math.max(MIN_SIZE, Math.abs(rawH));
  }

  // лівий верхній кут — або сама нерухома точка, або на ширину лівіше від неї.
  // Звідси випадає вся потрібна поведінка, без жодного окремого коду: поки
  // знак rawW той самий, і width (затиснута порогом), і цей кут щокадру ті
  // самі — фігура стоїть. Змінився знак — того ж кадру змінилось і те, і те:
  // переворот без проміжних станів
  const corner = {
    x: rawW >= 0 ? grip.x : grip.x - width,
    y: rawH >= 0 ? grip.y : grip.y - height,
  };
  const placed = rotateAround(corner, grip, rad);

  return {
    x: placed.x,
    y: placed.y,
    width,
    height,
    // рахується щокадру наново з поточного курсора; ніде не зберігається
    mirroredX: rawW * grip.signX < 0,
    mirroredY: rawH * grip.signY < 0,
  };
}

// як окремий обʼєкт виділення лягає в нову рамку. Для одинокого обʼєкта його
// прямокутник і є рамкою, тож виходить рівно те, що порахував resizeFromPointer
export function mapIntoBox(start: Rect, from: Rect, to: ResizeResult): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const offX = start.x - from.x;
  const offY = start.y - from.y;
  return {
    width: start.width * sx,
    height: start.height * sy,
    x: to.x + (to.mirroredX ? from.width - offX - start.width : offX) * sx,
    y: to.y + (to.mirroredY ? from.height - offY - start.height : offY) * sy,
  };
}

// обведення масштабуємо разом з фігурою (середнє по осях), інакше після
// resize воно лишається фіксованим у px і візуально "худне" на збільшеній фігурі.
// start — стан на ПОЧАТКУ жесту, не попередній кадр: рахунок від попереднього
// множив би сам себе щокадру
export function scaledStrokeWidth(
  start: { strokeWidth: number; width: number; height: number },
  size: { width: number; height: number },
) {
  const ratio = (size.width / start.width + size.height / start.height) / 2;
  return clamp(Math.round(start.strokeWidth * ratio), STROKE_WIDTH_MIN, STROKE_WIDTH_MAX);
}
