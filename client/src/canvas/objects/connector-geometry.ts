import Konva from 'konva';
import type { BoardPoint } from 'shared';

// 0 — ламана прямими відрізками, 1 — дуже "гумова" крива; 0.4 підібрав на око
export const CONNECTOR_TENSION = 0.4;

// прихована лінія лише щоб узяти в konva її ж контрольні точки сплайна —
// своя математика тензії рано чи пізно розійшлась би з тим, що намальовано
const measurer = new Konva.Line({ tension: CONNECTOR_TENSION });

// другорядні точки — на самій кривій (t=0.5 свого сегмента), а не посередині
// хорди, інакше біля вигину висять осторонь лінії. В моделі їх нема,
// рахуються на кожен рендер. konva веде перший і останній сегменти
// квадратичними кривими, середні — кубічними; tp — [cin, p, cout] на кожну
// внутрішню точку, тому сегмент k бере cout точки k і cin точки k+1
export function midpoints(points: BoardPoint[]): BoardPoint[] {
  const n = points.length;
  const chords: BoardPoint[] = [];
  for (let i = 0; i < n - 1; i++) chords.push(lerp(points[i], points[i + 1], 0.5));
  if (n < 3) return chords;

  measurer.points(flattenPoints(points));
  const tp: number[] = measurer.getTensionPoints();
  // при збігу сусідніх точок konva пропускає контрольні — індекси поїдуть
  if (tp.length !== 6 * (n - 2)) return chords;

  return chords.map((_, k) => {
    const p0 = points[k];
    const p1 = points[k + 1];
    if (k === 0) return quadMid(p0, { x: tp[0], y: tp[1] }, p1);
    if (k === n - 2) return quadMid(p0, { x: tp[tp.length - 2], y: tp[tp.length - 1] }, p1);
    const i = 6 * (k - 1);
    return cubicMid(p0, { x: tp[i + 4], y: tp[i + 5] }, { x: tp[i + 6], y: tp[i + 7] }, p1);
  });
}

function lerp(a: BoardPoint, b: BoardPoint, t: number): BoardPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// формули Безʼє при t=0.5
function quadMid(p0: BoardPoint, c: BoardPoint, p1: BoardPoint): BoardPoint {
  return { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
}

function cubicMid(p0: BoardPoint, c1: BoardPoint, c2: BoardPoint, p1: BoardPoint): BoardPoint {
  return {
    x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p1.x,
    y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p1.y,
  };
}

export function flattenPoints(points: BoardPoint[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}
