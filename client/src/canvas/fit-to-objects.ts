import type { BoardObject } from 'shared';
import { clampScale, MAX_SCALE } from './coordinates';
import type { Viewport } from './coordinates';
import { pivotOffset } from './object-pivot';

const FIT_PADDING_PX = 60;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// повернутий обʼєкт вилазить за свої x/y/width/height, тому беремо всі
// чотири кути, повернуті навколо його центру повороту
export function contentBounds(objects: BoardObject[]): Bounds | null {
  if (objects.length === 0) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const o of objects) {
    const pivot = pivotOffset(o);
    const pivotX = o.x + pivot.x;
    const pivotY = o.y + pivot.y;
    const angle = (o.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [cx, cy] of [
      [o.x, o.y],
      [o.x + o.width, o.y],
      [o.x, o.y + o.height],
      [o.x + o.width, o.y + o.height],
    ]) {
      const dx = cx - pivotX;
      const dy = cy - pivotY;
      const x = pivotX + dx * cos - dy * sin;
      const y = pivotY + dx * sin + dy * cos;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
}

// новий viewport, у якому всі передані обʼєкти вписані у видиму область
// з відступом; без обʼєктів — той самий дефолт, що й на старті (100%, центр)
export function fitToObjects(objects: BoardObject[], canvasWidth: number, canvasHeight: number): Viewport {
  const bounds = contentBounds(objects);
  if (!bounds) {
    return { x: canvasWidth / 2, y: canvasHeight / 2, scale: 1 };
  }
  const { minX, minY, maxX, maxY } = bounds;

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  const availableWidth = Math.max(1, canvasWidth - FIT_PADDING_PX * 2);
  const availableHeight = Math.max(1, canvasHeight - FIT_PADDING_PX * 2);

  const scale = clampScale(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight, MAX_SCALE),
  );

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    scale,
    x: canvasWidth / 2 - centerX * scale,
    y: canvasHeight / 2 - centerY * scale,
  };
}
