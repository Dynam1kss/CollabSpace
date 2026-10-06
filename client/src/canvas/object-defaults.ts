import { createId } from '@paralleldrive/cuid2';
import type {
  BoardObject,
  ConnectorObject,
  ImageObject,
  LinkObject,
  ParsedLink,
  LineObject,
  ShapeObject,
  ShapeKind,
  StickyColumn,
  StickyObject,
  TextObject,
} from 'shared';
import type { Point } from './coordinates';
import { withEnds, withPoints } from './objects/point-box';
import { fitTextBox } from './text-layout';
import { LINK_CHROME_HEIGHT } from './objects/LinkShape';
import { DEFAULT_INK } from '../theme';
import { i18n } from '../i18n';

// 8 заготовлених кольорів — без піпетки, свідомо обмежений вибір
export const PALETTE = [
  '#ffffff',
  '#fef08a',
  '#fca5a5',
  '#93c5fd',
  '#86efac',
  '#d8b4fe',
  '#fdba74',
  DEFAULT_INK,
];

export const DEFAULT_STROKE_COLOR = PALETTE[7];
export const DEFAULT_TEXT_COLOR = DEFAULT_INK;

// межі для полів панелі властивостей і для перерахунку при трансформації
export { FONT_SIZE_MAX, FONT_SIZE_MIN, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from './limits';

const STICKY_SIZE = { width: 160, height: 120 };
// довша сторона щойно вставленої картинки — щоб фото з телефону не накрило всю дошку
const IMAGE_MAX_SIDE = 320;
const SHAPE_SIZE = { width: 120, height: 90 };
// картка посилання: web — рядок із підписом і доменом; відео — квадратна
// мініатюра 1:1 плюс та сама «обгортка» з підписом під нею
const LINK_SIZE = { width: 260, height: 84 };
const LINK_VIDEO_WIDTH = 240;
const CONNECTOR_LENGTH = 140;
const MIN_DRAWN_SIZE = 8; // менше цього — вважаємо це кліком, не протягуванням

export type CreatableTool = 'sticky' | 'text' | 'rect' | 'ellipse' | 'connector' | 'line';

// усі інструменти, що щось створюють — список в одному місці, щоб перевірки
// не перелічували їх руками й не відставали від коду
export const CREATABLE_TOOLS: CreatableTool[] = ['sticky', 'text', 'rect', 'ellipse', 'connector', 'line'];

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
      return createSticky(point, meta);
    case 'text':
      return createText(point.x, point.y, meta);
    case 'rect':
    case 'ellipse':
      return createShape(tool, point.x, point.y, SHAPE_SIZE.width, SHAPE_SIZE.height, meta);
    case 'connector':
      return createConnector(point, { x: point.x + CONNECTOR_LENGTH, y: point.y }, meta);
    case 'line':
      return createLine(point, { x: point.x + CONNECTOR_LENGTH, y: point.y }, meta);
  }
}

// протягування для фігури — розмір одразу з drag-прямокутника. А от клік без
// протягування — це не «фігура 0x0»: замість крихти в кілька пікселів даємо
// стандартний розмір, як і клік стікером. Куток лишається там, де натиснули:
// саме так лягла б і протягнута фігура (модель тримає x/y як лівий верхній
// кут bbox — для еліпса теж, до центру його переводить уже ShapeNode)
export function createShapeFromRect(
  kind: ShapeKind,
  rect: { x: number; y: number; width: number; height: number },
  meta: CreationMeta,
): ShapeObject {
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  if (width < MIN_DRAWN_SIZE && height < MIN_DRAWN_SIZE) {
    return createShape(kind, rect.x, rect.y, SHAPE_SIZE.width, SHAPE_SIZE.height, meta);
  }
  return createShape(
    kind,
    rect.x,
    rect.y,
    Math.max(MIN_DRAWN_SIZE, width),
    Math.max(MIN_DRAWN_SIZE, height),
    meta,
  );
}

// протягування для прямої — те саме правило, що й у зʼєднувача: надто короткий
// жест вважаємо кліком і даємо стандартну довжину
export function createLineFromPoints(from: Point, to: Point, meta: CreationMeta): LineObject {
  if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_DRAWN_SIZE) {
    return createLine(from, { x: from.x + CONNECTOR_LENGTH, y: from.y }, meta);
  }
  return createLine(from, to, meta);
}

function createLine(from: Point, to: Point, meta: CreationMeta): LineObject {
  return {
    ...baseFields(meta),
    ...withEnds(from, to),
    type: 'line',
    strokeColor: DEFAULT_STROKE_COLOR,
    strokeWidth: 2,
  };
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

// експортована окремо, бо канбан створює стікер одразу в колонці
export function createSticky(
  point: Point,
  meta: CreationMeta,
  column: StickyColumn | null = null,
): StickyObject {
  return {
    ...baseFields(meta),
    type: 'sticky',
    x: point.x,
    y: point.y,
    width: STICKY_SIZE.width,
    height: STICKY_SIZE.height,
    text: '',
    fillColor: PALETTE[1],
    textColor: DEFAULT_TEXT_COLOR,
    column,
  };
}

// пропорції з файла, довша сторона не більша за IMAGE_MAX_SIDE
export function fitImageSize(naturalWidth: number, naturalHeight: number) {
  const k = Math.min(1, IMAGE_MAX_SIDE / Math.max(naturalWidth, naturalHeight, 1));
  return { width: Math.round(naturalWidth * k), height: Math.round(naturalHeight * k) };
}

export function createImage(
  point: Point,
  size: { width: number; height: number },
  url: string,
  meta: CreationMeta,
): ImageObject {
  return {
    ...baseFields(meta),
    type: 'image',
    x: point.x,
    y: point.y,
    width: size.width,
    height: size.height,
    url,
  };
}

// адресу сюди передають уже розібраною (shared/parseLinkUrl) — створювати
// картку з рядка, якого ми не перевірили, не можна
export function createLink(point: Point, parsed: ParsedLink, meta: CreationMeta): LinkObject {
  const size =
    parsed.kind === 'youtube'
      ? { width: LINK_VIDEO_WIDTH, height: LINK_VIDEO_WIDTH + LINK_CHROME_HEIGHT }
      : LINK_SIZE;
  return {
    ...baseFields(meta),
    type: 'link',
    x: point.x,
    y: point.y,
    ...size,
    url: parsed.url,
    kind: parsed.kind,
    ...(parsed.videoId ? { videoId: parsed.videoId } : {}),
  };
}

function createText(x: number, y: number, meta: CreationMeta): TextObject {
  // вміст дошки, а не інтерфейс — мовою того, хто створює
  const base = { text: i18n.t('board.defaultText'), fontSize: 18, autoWidth: true, minHeight: 0, width: 0 };
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
