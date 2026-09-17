import type { BoardObject } from 'shared';
import { clampScale, MAX_SCALE } from './coordinates';
import type { Viewport } from './coordinates';

const FIT_PADDING_PX = 60;

// новий viewport, у якому всі передані обʼєкти вписані у видиму область
// з відступом; без обʼєктів — той самий дефолт, що й на старті (100%, центр)
export function fitToObjects(objects: BoardObject[], canvasWidth: number, canvasHeight: number): Viewport {
  if (objects.length === 0) {
    return { x: canvasWidth / 2, y: canvasHeight / 2, scale: 1 };
  }

  const minX = Math.min(...objects.map((o) => o.x));
  const minY = Math.min(...objects.map((o) => o.y));
  const maxX = Math.max(...objects.map((o) => o.x + o.width));
  const maxY = Math.max(...objects.map((o) => o.y + o.height));

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
