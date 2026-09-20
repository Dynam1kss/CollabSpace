import type { Box } from 'konva/lib/shapes/Transformer';
import { MIN_SIZE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from '../limits';

export { MIN_SIZE };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// початок рамки вважаємо нерухомим, якщо він не зрушив. konva віддає тут
// рівно нуль (заміряно), запас — суто на похибку float
const FIXED_END_EPS = 0.01;

// одна вісь рамки, незалежно від другої.
//
// originShift — на скільки поїхав ПОЧАТОК рамки вздовж цієї осі. Якщо він
// на місці, нерухомий кінець — сам початок (тягнуть правий чи нижній бік);
// якщо поїхав — нерухомий дальній кінець (тягнуть лівий чи верхній). Обидва
// випадки трапляються одночасно на одній рамці: у ручки «правий верхній»
// ширина рахується від початку, а висота — від дальнього кінця.
//
// Далі все просто: беремо відстань від нерухомого кінця до курсора ЗІ ЗНАКОМ.
// Модуль дає розмір (не менший за поріг), знак — бік, на якому стоїть фігура.
// Ніякої памʼяті між кадрами: розмір — чиста функція від того, де курсор
// ЗАРАЗ. Звідси три речі одразу. Поки курсор ближче за поріг, модуль завжди
// дорівнює порогу — фігура стоїть і на рух не реагує. Щойно курсор перейшов
// нерухомий кінець, знак міняється — і фігура дзеркалиться тієї ж миті, вже
// в розмірі, що відповідає новій відстані, без відставання. І назад із
// приніжної зони вона рушає рівно тоді, коли відстань знову переростає поріг
function clampAxis(originShift: number, side: number) {
  const fixedAtOrigin = Math.abs(originShift) < FIXED_END_EPS;
  const fixedEnd = fixedAtOrigin ? 0 : side;
  const distance = fixedAtOrigin ? side : -side;
  const limited = Math.abs(distance) < MIN_SIZE ? Math.sign(distance || 1) * MIN_SIZE : distance;
  // сторона рамки завжди додатна: знак уже врахований зсувом початку
  return { offset: fixedEnd + Math.min(0, limited), length: Math.abs(limited) };
}

// поріг розміру й дзеркалення — обидва тут, у координатах конви, ДО того як
// вона застосує трансформацію.
//
// Поріг саме тут, а не після (як колись Math.max у bakeScale), бо інакше
// вузол і те, що конва про нього думає, розʼїжджаються: фігура залипала на
// 8px і далі просто їздила за курсором.
//
// А знак не віддаємо конві взагалі. Побачивши відʼємну ширину, _fitNodesInto
// перейменовує активну ручку (right → left) І віддає відʼємний scale, який
// decompose() перетворює на поворот 180°. Поворот перекладає ручки місцями
// ще раз — виходить подвійне дзеркалення, після якого імʼя активної ручки
// вказує на ТУ, ЩО МАЛА СТОЯТИ НЕРУХОМО. Далі конва тягне нерухомий кут за
// курсором, і розмір подвоюється щомаху. На повільному жесті цього не видно,
// бо рамка не встигає стати відʼємною; різкий мах перестрибує приніжну зону
// за одну подію. Ми лишаємо перейменування ручки (воно правильне: після
// дзеркалення тягнуть уже інший кут) без повороту — одне дзеркалення замість
// двох.
//
// Кадр більше не відкидаємо ніколи. Відкинутий кадр означав, що фігура стоїть,
// а курсор іде далі — і жест накопичував розбіжність між ними
export function limitBoxSize(oldBox: Box, newBox: Box): Box {
  const cos = Math.cos(newBox.rotation);
  const sin = Math.sin(newBox.rotation);
  const dx = newBox.x - oldBox.x;
  const dy = newBox.y - oldBox.y;
  const across = clampAxis(dx * cos + dy * sin, newBox.width);
  const down = clampAxis(-dx * sin + dy * cos, newBox.height);
  return {
    ...newBox,
    x: newBox.x + across.offset * cos - down.offset * sin,
    y: newBox.y + across.offset * sin + down.offset * cos,
    width: across.length,
    height: down.length,
  };
}

// відʼємний scale означає дзеркалення: розмір беремо за модулем, а знак
// далі перетворюється на зсув позиції (див. bakeScale)
export function bakedSide(size: number, scale: number, min = MIN_SIZE) {
  return Math.max(min, Math.abs(size * scale));
}

// обведення масштабуємо разом з фігурою (середнє по осях), інакше після
// resize воно лишається фіксованим у px і візуально "худне" на збільшеній фігурі.
// start — стан на ПОЧАТКУ жесту, не попередній кадр: рахунок від попереднього
// множив би сам себе щокадру, і один прохід біля нуля (де розмір лягає на
// поріг) розганяв товщину до максимуму за два-три перетини
export function scaledStrokeWidth(
  start: { strokeWidth: number; width: number; height: number },
  size: { width: number; height: number },
) {
  const ratio = (size.width / start.width + size.height / start.height) / 2;
  return clamp(Math.round(start.strokeWidth * ratio), STROKE_WIDTH_MIN, STROKE_WIDTH_MAX);
}
