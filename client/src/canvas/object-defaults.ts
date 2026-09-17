import { createId } from '@paralleldrive/cuid2';
import type { BoardObject, ConnectorObject, ShapeObject, ShapeKind, StickyObject, TextObject } from 'shared';
import type { Point } from './coordinates';
import { withPoints } from './objects/connector-geometry';
import { fitTextBox } from './text-layout';

// 8 заготовлених кольорів — без піпетки, свідомо обмежений вибір
export const PALETTE = [
  '#ffffff',
  '#fef08a',
  '#fca5a5',
  '#93c5fd',
  '#86efac',
  '#d8b4fe',
  '#fdba74',
  '#1f2937',
];

export const DEFAULT_STROKE_COLOR = PALETTE[7];
export const DEFAULT_TEXT_COLOR = '#1f2937';

// межі для полів панелі властивостей і для перерахунку при трансформації
export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 20;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 200;

const STICKY_SIZE = { width: 160, height: 120 };
const SHAPE_SIZE = { width: 120, height: 90 };
const CONNECTOR_LENGTH = 140;
const MIN_DRAWN_SIZE = 8; // менше цього — вважаємо це кліком, не протягуванням

export type CreatableTool = 'sticky' | 'text' | 'rect' | 'ellipse' | 'connector';

interface CreationMeta {
  createdBy: string;
  zIndex: number;
}

function baseFields(meta: CreationMeta) {
  return {
    id: createId(),
    rotation: 0,
    zIndex: meta.zIndex,
    createdBy: meta.createdBy,
    createdAt: new Date().toISOString(),
  };
}

// клік інструментом (без протягування) — обʼєкт стандартного розміру в цій точці
export function createAtPoint(tool: CreatableTool, point: Point, meta: CreationMeta): BoardObject {
  switch (tool) {
    case 'sticky':
      return createSticky(point.x, point.y, STICKY_SIZE.width, STICKY_SIZE.height, meta);
    case 'text':
      return createText(point.x, point.y, meta);
    case 'rect':
    case 'ellipse':
      return createShape(tool, point.x, point.y, SHAPE_SIZE.width, SHAPE_SIZE.height, meta);
    case 'connector':
      return createConnector(point, { x: point.x + CONNECTOR_LENGTH, y: point.y }, meta);
  }
}

// протягування для фігури — розмір одразу з drag-прямокутника
export function createShapeFromRect(
  kind: ShapeKind,
  rect: { x: number; y: number; width: number; height: number },
  meta: CreationMeta,
): ShapeObject {
  const width = Math.max(MIN_DRAWN_SIZE, Math.abs(rect.width));
  const height = Math.max(MIN_DRAWN_SIZE, Math.abs(rect.height));
  return createShape(kind, rect.x, rect.y, width, height, meta);
}

// протягування для зʼєднувача — кінці саме там, де відпустили/натиснули палець/курсор
export function createConnectorFromPoints(from: Point, to: Point, meta: CreationMeta): ConnectorObject {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < MIN_DRAWN_SIZE) {
    return createConnector(from, { x: from.x + CONNECTOR_LENGTH, y: from.y }, meta);
  }
  return createConnector(from, to, meta);
}

function createSticky(x: number, y: number, width: number, height: number, meta: CreationMeta): StickyObject {
  return {
    ...baseFields(meta),
    type: 'sticky',
    x,
    y,
    width,
    height,
    text: '',
    fillColor: PALETTE[1],
    textColor: DEFAULT_TEXT_COLOR,
  };
}

function createText(x: number, y: number, meta: CreationMeta): TextObject {
  const base = { text: 'Текст', fontSize: 18, autoWidth: true, minHeight: 0, width: 0 };
  return {
    ...baseFields(meta),
    ...base,
    ...fitTextBox(base),
    type: 'text',
    x,
    y,
    color: DEFAULT_TEXT_COLOR,
  };
}

function createShape(
  kind: ShapeKind,
  x: number,
  y: number,
  width: number,
  height: number,
  meta: CreationMeta,
): ShapeObject {
  return {
    ...baseFields(meta),
    type: 'shape',
    shapeKind: kind,
    x,
    y,
    width,
    height,
    fillColor: PALETTE[0],
    strokeColor: DEFAULT_STROKE_COLOR,
    strokeWidth: 2,
  };
}

function createConnector(from: Point, to: Point, meta: CreationMeta): ConnectorObject {
  return {
    ...baseFields(meta),
    ...withPoints([from, to]),
    type: 'connector',
    strokeColor: DEFAULT_STROKE_COLOR,
    strokeWidth: 2,
    arrowEnd: true,
  };
}
