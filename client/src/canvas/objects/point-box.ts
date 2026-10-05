import type { BoardPoint } from 'shared';

// bounding box по всіх точках — єдине місце, де рахуються x/y/width/height
// лінійних обʼєктів; хто міняє points, той і має прогнати їх через це.
// Окремо від connector-geometry: той тягне konva (міряє нею ж контрольні точки
// сплайна), а цю математику треба й там, де полотна немає
export function withPoints(points: BoardPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { points, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// рамка прямої по двох її кінцях. Окрема від withPoints, бо в лінії модель
// інша — два іменовані кінці, а не масив точок
export function withEnds(from: BoardPoint, to: BoardPoint) {
  return {
    from,
    to,
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}
