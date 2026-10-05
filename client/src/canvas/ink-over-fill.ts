import type { BoardObject } from 'shared';
import { DEFAULT_INK } from '../theme';
import { contentBounds } from './fit-to-objects';
import type { Bounds } from './fit-to-objects';

// колір «чорнила» обʼєкта — те, що в темній темі підмінюється світлим
function inkOf(o: BoardObject) {
  if (o.type === 'text') return o.color;
  if (o.type === 'shape' || o.type === 'connector' || o.type === 'line') return o.strokeColor;
  return null;
}

// що закриває полотно під собою: стікер, фігура з заливкою, картинка
function isOpaque(o: BoardObject) {
  if (o.type === 'sticky' || o.type === 'image') return true;
  return o.type === 'shape' && o.fillColor !== 'transparent';
}

function contains(b: Bounds, x: number, y: number) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

// id обʼєктів із дефолтним чорнилом, що лежать поверх чогось непрозорого —
// у них підміну на світле не робимо, бо світле на стікері не читається.
// «поверх» — центр рамки всередині рамки нижчого за z обʼєкта; не будь-яке
// перекриття: зʼєднувач торкається стікерів кінцями, а лежить на полотні
export function inkOverFill(objects: BoardObject[]): Set<string> {
  const covers = objects.filter(isOpaque).map((o) => ({ z: o.zIndex, bounds: contentBounds([o]) as Bounds }));
  const result = new Set<string>();
  if (covers.length === 0) return result;
  for (const o of objects) {
    const ink = inkOf(o);
    if (!ink || ink.toLowerCase() !== DEFAULT_INK) continue;
    const b = contentBounds([o]) as Bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    if (covers.some((c) => c.z < o.zIndex && contains(c.bounds, cx, cy))) result.add(o.id);
  }
  return result;
}
