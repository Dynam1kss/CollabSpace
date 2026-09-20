export interface Point {
  x: number;
  y: number;
}

// x, y — де на екрані (в пікселях) знаходиться початок координат дошки (0,0)
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

// 0.02, а не 0.1: на мінімумі видно вп'ятеро ширшу й вищу ділянку дошки.
// Наближення не чіпаємо — це лише про те, як далеко можна відʼїхати
export const MIN_SCALE = 0.02;
export const MAX_SCALE = 4;

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

export function screenToBoard(screenPoint: Point, viewport: Viewport): Point {
  return {
    x: (screenPoint.x - viewport.x) / viewport.scale,
    y: (screenPoint.y - viewport.y) / viewport.scale,
  };
}

export function boardToScreen(boardPoint: Point, viewport: Viewport): Point {
  return {
    x: boardPoint.x * viewport.scale + viewport.x,
    y: boardPoint.y * viewport.scale + viewport.y,
  };
}

// прямокутник у координатах дошки, який зараз видно у вікні screenWidth×screenHeight
export function getVisibleBoardRect(viewport: Viewport, screenWidth: number, screenHeight: number) {
  const topLeft = screenToBoard({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToBoard({ x: screenWidth, y: screenHeight }, viewport);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

// новий viewport такий, щоб точка дошки під screenPoint лишилась під ним і після зміни масштабу
export function zoomViewportAtPoint(viewport: Viewport, newScale: number, screenPoint: Point): Viewport {
  const scale = clampScale(newScale);
  const boardPoint = screenToBoard(screenPoint, viewport);
  return {
    scale,
    x: screenPoint.x - boardPoint.x * scale,
    y: screenPoint.y - boardPoint.y * scale,
  };
}

// один крок щипка: масштаб відносно ПОПЕРЕДНЬОЇ середньої точки (точка дошки,
// що була під пальцями, лишається під екранною позицією prevMidpoint), потім
// зсув на те, наскільки середня точка встигла переміститись до currentMidpoint.
// Разом — точка дошки під пальцями лишається під ними протягом усього жесту.
// Якщо зумити відносно currentMidpoint (а не prevMidpoint), той самий зсув після
// додає зайве подвоєння — полотно "перестрибує" замість того, щоб клеїтись до пальців
export function pinchViewport(
  viewport: Viewport,
  newScale: number,
  prevMidpoint: Point,
  currentMidpoint: Point,
): Viewport {
  const scaled = zoomViewportAtPoint(viewport, newScale, prevMidpoint);
  return {
    scale: scaled.scale,
    x: scaled.x + (currentMidpoint.x - prevMidpoint.x),
    y: scaled.y + (currentMidpoint.y - prevMidpoint.y),
  };
}
