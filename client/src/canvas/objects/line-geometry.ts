import { lineDash } from 'shared';
import type { LineDash, LineObject } from 'shared';

// штрих у величинах konva: довжини сегментів у координатах дошки. Множимо на
// товщину, щоб на товстій лінії пунктир не злипався в суцільну
const DASH_RATIO = 3;
const DOT_GAP_RATIO = 2;

export function dashPattern(object: { dash?: LineDash; strokeWidth: number }): number[] | undefined {
  const width = Math.max(1, object.strokeWidth);
  switch (lineDash(object)) {
    case 'dashed':
      return [width * DASH_RATIO, width * DASH_RATIO];
    // крапка — нульовий сегмент із круглим кінцем; саме так konva малює точки
    case 'dotted':
      return [0.01, width * DOT_GAP_RATIO];
    case 'solid':
      return undefined;
  }
}

// зсув цілої лінії: рухаються обидва кінці, рамка — за ними
export function movedLine(object: LineObject, dx: number, dy: number) {
  return {
    from: { x: object.from.x + dx, y: object.from.y + dy },
    to: { x: object.to.x + dx, y: object.to.y + dy },
    x: object.x + dx,
    y: object.y + dy,
  };
}

export function lineLength(object: Pick<LineObject, 'from' | 'to'>) {
  return Math.hypot(object.to.x - object.from.x, object.to.y - object.from.y);
}
