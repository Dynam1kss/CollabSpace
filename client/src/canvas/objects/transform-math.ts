import type { Box } from 'konva/lib/shapes/Transformer';
import type { Point } from '../coordinates';
import { MIN_SIZE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from '../limits';

export { MIN_SIZE };

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// кут, на який спирається весь жест: протилежний до взятої ручки. Беремо
// його ОДИН раз, на першому кадрі, поки рамка ще не чіпана, і далі весь
// жест рахуємо від нього.
//
// Спокуса шукати нерухомий кінець щокадру (по тому, який край рамки не
// зрушив) виглядає рівноцінною, але не є: _getNodeRect віддає рамку РАЗОМ
// З обведенням, тож щокадру набігає піваобведення. Поки фігура більша за
// поріг, це нічого не значить, а в приніжній зоні, де розмір задаємо ми
// самі, ця похибка тягне «нерухомий» кут за курсором — і курсор не може
// його наздогнати, щоб перетнути. Зовні це виглядало так, ніби фігура
// цілком їде за мишею, не дзеркалячись
export function fixedCornerOf(box: Box, anchor: string | null): Point {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const name = anchor ?? '';
  // тягнуть лівий бік — отже нерухомий правий, і навпаки
  const alongU = name.includes('left') ? box.width : 0;
  const alongV = name.includes('top') ? box.height : 0;
  return {
    x: box.x + alongU * cos - alongV * sin,
    y: box.y + alongU * sin + alongV * cos,
  };
}

export function isResizeAnchor(anchor: string | null) {
  return !!anchor && anchor !== 'rotater';
}

// кутова ручка тягне обидві осі; ребро — лише одну
export function isCornerAnchor(anchor: string | null) {
  const name = anchor ?? '';
  return (name.includes('top') || name.includes('bottom')) && (name.includes('left') || name.includes('right'));
}

// з двох кінців сторони рухомий той, що ДАЛІ від нерухомого кута (обидва
// тут — уже відстані від нього). Ближній і є сам кут. По осі, яку ця ручка
// не змінює, дальній кінець — протилежний бік рамки, і сторона лишається
// такою, як була
function movingEnd(nearSide: number, farSide: number) {
  return Math.abs(nearSide) >= Math.abs(farSide) ? nearSide : farSide;
}

// розмір по одній осі: модуль відстані, але не менший за поріг; знак лишаємо,
// бо саме він каже, на якому боці від нерухомого кута стоїть фігура
function limitDistance(distance: number) {
  if (Math.abs(distance) >= MIN_SIZE) return distance;
  return Math.sign(distance || 1) * MIN_SIZE;
}

// на якому боці від нерухомого кута стоїть готова рамка. Початок рамки
// збігається з кутом, поки бік додатний, і відʼїжджає за нього, коли
// фігуру віддзеркалило — тому знак проекції початку й відповідає на питання.
// Потрібне тільки для вмісту, що має верх і низ (картинка): самі
// x/y/width/height від цього не залежать
export function mirroredAxes(fixed: Point, box: Box) {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const relX = box.x - fixed.x;
  const relY = box.y - fixed.y;
  return {
    x: relX * cos + relY * sin < -1e-6,
    y: -relX * sin + relY * cos < -1e-6,
  };
}

// поріг розміру й дзеркалення — обидва тут, у координатах конви, ДО того як
// вона застосує трансформацію.
//
// Рамку будуємо від нерухомого кута й відстані до курсора:
//
//     розмір = max(ПОРІГ, |відстань|),  бік = знак(відстань)
//
// Від попередніх кадрів не залежить нічого: ні памʼяті, ні порівнянь із
// минулою рамкою. Тому в приніжній зоні рамка збігається сама з собою до
// пікселя — не міняється ні розмір, ні ПОЛОЖЕННЯ, хоч як водити курсором.
// Щойно знак відстані міняється, фігура дзеркалиться тієї ж миті, вже в
// розмірі під курсор.
//
// Знак не віддаємо конві взагалі. Побачивши відʼємну ширину, _fitNodesInto
// перейменовує активну ручку (right → left) І віддає відʼємний scale, який
// decompose() перетворює на поворот 180°. Поворот перекладає ручки місцями
// ще раз — виходить подвійне дзеркалення, після якого імʼя активної ручки
// вказує на ту, що мала стояти нерухомо, і розмір подвоюється щомаху
export function limitBoxSize(fixed: Point, newBox: Box, lockedRatio = false): Box {
  const cos = Math.cos(newBox.rotation);
  const sin = Math.sin(newBox.rotation);
  // початок рамки відносно нерухомого кута, у її власних осях
  const relX = newBox.x - fixed.x;
  const relY = newBox.y - fixed.y;
  const originU = relX * cos + relY * sin;
  const originV = -relX * sin + relY * cos;

  const across = movingEnd(originU, originU + newBox.width);
  const down = movingEnd(originV, originV + newBox.height);
  const limitedAcross = limitDistance(across);
  const limitedDown = limitDistance(down);
  // із заблокованою пропорцією осі не живуть окремо: коли одна лягла на
  // поріг, друга вже теж там (вони міняються разом). Кладемо на поріг
  // обидві — інакше konva довертає рамку по гіпотенузі, узятій ще на
  // натисканні, і розмір дрібно гуляє замість того, щоб завмерти
  const atFloor =
    lockedRatio && (Math.abs(limitedAcross) <= MIN_SIZE || Math.abs(limitedDown) <= MIN_SIZE);
  const acrossValue = atFloor ? Math.sign(across || 1) * MIN_SIZE : limitedAcross;
  const downValue = atFloor ? Math.sign(down || 1) * MIN_SIZE : limitedDown;
  const acrossStart = Math.min(0, acrossValue);
  const downStart = Math.min(0, downValue);

  return {
    ...newBox,
    x: fixed.x + acrossStart * cos - downStart * sin,
    y: fixed.y + acrossStart * sin + downStart * cos,
    width: Math.abs(acrossValue),
    height: Math.abs(downValue),
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
