import { Shape } from 'react-konva';
import type Konva from 'konva';
import { getVisibleBoardRect } from './coordinates';
import type { Viewport } from './coordinates';

const SPACING = 40; // крок сітки в координатах дошки
const DOT_RADIUS = 2;
const MIN_SCREEN_SPACING = 6; // px — густіше просто зливається в шум, не малюємо

interface Props {
  viewport: Viewport;
  width: number;
  height: number;
}

export function Grid({ viewport, width, height }: Props) {
  if (width === 0 || height === 0 || SPACING * viewport.scale < MIN_SCREEN_SPACING) {
    return null;
  }

  const rect = getVisibleBoardRect(viewport, width, height);
  const startX = Math.floor(rect.x / SPACING) * SPACING;
  const startY = Math.floor(rect.y / SPACING) * SPACING;
  const endX = rect.x + rect.width;
  const endY = rect.y + rect.height;

  return (
    <Shape
      listening={false}
      sceneFunc={(context: Konva.Context) => {
        // малюємо в координатах дошки — трансформ Stage (x/y/scale) сам
        // переводить їх на екран, тому крапки масштабуються разом з полотном
        context.beginPath();
        for (let bx = startX; bx <= endX; bx += SPACING) {
          for (let by = startY; by <= endY; by += SPACING) {
            context.moveTo(bx + DOT_RADIUS, by);
            context.arc(bx, by, DOT_RADIUS, 0, Math.PI * 2);
          }
        }
        context.fillStyle = '#d5d5d5';
        context.fill();
      }}
    />
  );
}
