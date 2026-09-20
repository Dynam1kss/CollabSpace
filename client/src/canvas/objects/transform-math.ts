import type { Box } from 'konva/lib/shapes/Transformer';
import { MIN_SIZE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from '../limits';

export { MIN_SIZE };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// нижня межа розміру — у координатах конви, ДО того як вона застосує
// трансформацію. Так її власна математика лишається цілою: кадр, який зробив
// би фігуру меншою за поріг, просто відкидаємо. Раніше поріг накладався вже
// після (Math.max у bakeScale), і тоді вузол і те, що конва про нього думає,
// розʼїжджались — фігура залипала на 8px і далі просто їздила за курсором.
// Знак не чіпаємо: відʼємна ширина у конви — це і є дзеркалення
export function limitBoxSize(oldBox: Box, newBox: Box): Box {
  if (Math.abs(newBox.width) < MIN_SIZE || Math.abs(newBox.height) < MIN_SIZE) return oldBox;
  return newBox;
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
