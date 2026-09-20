import type { Box } from 'konva/lib/shapes/Transformer';
import { MIN_SIZE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from '../limits';

export { MIN_SIZE };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// відʼємна сторона у конви означає дзеркалення. Переписуємо таку рамку в
// додатну, зсунувши початок на протилежний край — рамка описує ту саму
// площу, але вже без знака. Зсув іде вздовж ВЛАСНИХ осей рамки, тому при
// повороті множимо на sin/cos (rotation тут у радіанах — так його кладе
// _fitNodesInto)
function withPositiveSides(box: Box): Box {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  let { x, y, width, height } = box;
  if (width < 0) {
    x += width * cos;
    y += width * sin;
    width = -width;
  }
  if (height < 0) {
    x -= height * sin;
    y += height * cos;
    height = -height;
  }
  return { ...box, x, y, width, height };
}

// нижня межа розміру — у координатах конви, ДО того як вона застосує
// трансформацію. Так її власна математика лишається цілою: кадр, який зробив
// би фігуру меншою за поріг, просто відкидаємо. Раніше поріг накладався вже
// після (Math.max у bakeScale), і тоді вузол і те, що конва про нього думає,
// розʼїжджались — фігура залипала на 8px і далі просто їздила за курсором.
//
// А відʼємну рамку одразу нормалізуємо, і ось чому. _fitNodesInto, побачивши
// відʼємну ширину, перейменовує активну ручку (right → left) І віддає
// відʼємний scale, який decompose() перетворює на поворот 180°. Поворот
// перекладає ручки місцями ще раз — виходить подвійне дзеркалення, після
// якого імʼя активної ручки вказує на ТУ, ЩО МАЛА СТОЯТИ НЕРУХОМО. Далі
// конва тягне нерухомий кут за курсором, і розмір подвоюється щомаху.
// На повільному жесті цього не видно: там рамка встигає впертись у поріг
// вище й до відʼємної ширини не доходить. Різкий мах перестрибує приніжну
// зону за одну подію — |ширина| одразу більша за поріг, і кадр проходить.
// Нормалізація лишає перейменування ручки (воно саме по собі правильне:
// після дзеркалення тягнуть уже інший кут) без повороту — одне дзеркалення
// замість двох
export function limitBoxSize(oldBox: Box, newBox: Box): Box {
  if (Math.abs(newBox.width) < MIN_SIZE || Math.abs(newBox.height) < MIN_SIZE) return oldBox;
  return withPositiveSides(newBox);
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
