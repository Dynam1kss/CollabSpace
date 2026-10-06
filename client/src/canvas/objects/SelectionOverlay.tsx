import { useEffect, useMemo, useRef, useState } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { RefObject } from 'react';
import type {
  BoardObject,
  BoardPoint,
  ImageObject,
  LinkObject,
  ShapeObject,
  StickyObject,
  TextObject,
} from 'shared';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { Point } from '../coordinates';
import { useBoardStore } from '../board-store';
import { frameCoalescer } from '../frame-coalescer';
import { useEditorStore } from '../editor-store';
import { isMovable } from '../object-lock';
import { pivotOffset } from '../object-pivot';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../object-defaults';
import { MIN_BOX_SIDE } from '../limits';
import { fitTextBox } from '../text-layout';
import { flattenPoints } from './connector-geometry';
import { withEnds, withPoints } from './point-box';
import {
  MIN_SIZE,
  gripFor,
  isCornerHandle,
  handlePoint,
  mapIntoBox,
  resizeFromPointer,
  scaledStrokeWidth,
  toModelRect,
} from './transform-math';
import type { Rect, ResizeGrip, ResizeResult } from './transform-math';
import { useCanvasColors } from '../../theme';

// обʼєкти, чия геометрія — звичайний прямокутник: саме їх тягне нова
// математика. Текст (шрифт/перенос) і конектор (точки) лишаються на своєму
// шляху — у них розмір не зводиться до x/y/width/height
type RectObject = ShapeObject | StickyObject | ImageObject | LinkObject;

function isRectObject(obj: BoardObject): obj is RectObject {
  return obj.type === 'shape' || obj.type === 'sticky' || obj.type === 'image' || obj.type === 'link';
}

interface TextStart {
  fontSize: number;
  minHeight: number;
  autoWidth: boolean;
  width: number;
  height: number;
}

interface ResizeGesture {
  grip: ResizeGrip;
  // рамка виділення на початку жесту
  from: Rect;
  lockRatio: boolean;
  // на скільки курсор схибив повз ручку на натисканні
  grabOffset: Point;
  items: { id: string; start: Rect; flipX: boolean; flipY: boolean }[];
  // жест над одиноким текстом: у нього розмір — це шрифт і перенос
  handle: string;
  text: TextStart | null;
}

// рамка виділення в координатах дошки — обʼєднання всіх узятих обʼєктів
function unionRect(objects: RectObject[]): Rect {
  const x = Math.min(...objects.map((o) => o.x));
  const y = Math.min(...objects.map((o) => o.y));
  const right = Math.max(...objects.map((o) => o.x + o.width));
  const bottom = Math.max(...objects.map((o) => o.y + o.height));
  return { x, y, width: right - x, height: bottom - y };
}

const STICKY_PADDING = 10; // те саме, що відступ тексту в StickyNoteShape
const ANCHOR_SIZE = 12;
// ширина невидимої смужки захвату вздовж ребра текстового блоку (px екрана)
const EDGE_GRAB_PX = 10;
// мінімальна ціль під палець. Ручку не роздуваємо — росте лише невидима зона
// довкола неї: hitStrokeWidth малюється по контуру, половина йде назовні,
// тому до діаметра ручки додається рівно ця величина
const TOUCH_TARGET_PX = 44;
const TOUCH_HIT_STROKE = TOUCH_TARGET_PX - ANCHOR_SIZE;

const ALL_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-right',
  'middle-left',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
// текст: кути — розмір шрифту, боки — межа ширини, низ — мінімальна висота;
// верхнього ребра нема, бо висота росте лише вниз від вмісту
const TEXT_ANCHORS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'middle-left',
  'middle-right',
  'bottom-center',
];
// картинка: лише кути — keepRatio у konva стримує пропорції тільки на кутових
// ручках, бокові тягнуть одну сторону попри прапорець
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function isEdgeAnchor(name: string | null) {
  return name === 'middle-left' || name === 'middle-right' || name === 'bottom-center';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// бокові/нижні ручки тексту — не кружечки, а прозорі смужки вздовж ребра;
// update() трансформера щоразу скидає їм розмір до anchorSize, тому
// перевизначаємо тут, а не один раз при створенні
function styleTextAnchor(anchor: Konva.Rect, grab: number) {
  const name = anchor.name().split(' ')[0];
  const tr = anchor.getParent() as Konva.Transformer;
  const w = Math.abs(tr.width());
  const h = Math.abs(tr.height());
  if (name === 'middle-left' || name === 'middle-right') {
    // коротша за ребро на розмір кутів, інакше перекриває кутові ручки
    const len = Math.max(0, h - ANCHOR_SIZE * 2);
    anchor.setAttrs({
      width: grab,
      height: len,
      offsetX: grab / 2,
      offsetY: len / 2,
      fill: 'transparent',
      stroke: 'transparent',
    });
  } else if (name === 'bottom-center') {
    const len = Math.max(0, w - ANCHOR_SIZE * 2);
    anchor.setAttrs({
      width: len,
      height: grab,
      offsetX: len / 2,
      offsetY: grab / 2,
      fill: 'transparent',
      stroke: 'transparent',
    });
  }
}

// одна функція оформлення на обидва випадки: смужки тексту і розширена зона
// під палець. Смужці власного hitStrokeWidth не даємо — вона й так завширшки
// з ціль, а зайве обведення накрило б кутові ручки поруч
function anchorStyler(soleText: boolean, touch: boolean) {
  if (!soleText && !touch) return undefined;
  const grab = touch ? TOUCH_TARGET_PX : EDGE_GRAB_PX;
  return (anchor: Konva.Rect) => {
    const edge = soleText && isEdgeAnchor(anchor.name().split(' ')[0]);
    if (soleText) styleTextAnchor(anchor, grab);
    if (touch && !edge) anchor.hitStrokeWidth(TOUCH_HIT_STROKE);
  };
}

interface Props {
  // саме ref-обʼєкт, а не .current — читати .current можна лише поза рендером
  // (в ефектах/обробниках), інакше React не бачить, коли компонент має оновитись
  nodesByIdRef: RefObject<Record<string, Konva.Node>>;
  // росте щоразу, як реєструється/знімається якийсь вузол — див. коментар
  // біля setNodesVersion у BoardCanvas
  nodesVersion: number;
  // obʼєкти й виділення навмисно пропсами від BoardCanvas, а не зі сторів
  // напряму: фігури отримують нові розміри через Stage від React DOM, а
  // підписка на стор тут спрацювала б у власному коміті react-konva РАНІШЕ —
  // і forceUpdate нижче міряв би ще старі вузли (так і виглядав баг з рамкою)
  objects: Record<string, BoardObject>;
  selectedIds: string[];
  // те, що зараз редагує хтось інший — ручок розміру й повороту на ньому не даємо
  lockedByOthers: Set<string>;
  // працюють пальцем: ручки лишаються того ж розміру, зона захвату росте
  touchInput: boolean;
}

// маркери зміни розміру/повороту — вбудований Konva Transformer (сам тримає
// консистентний розмір ручок незалежно від зуму). Конектор, виділений сам,
// сюди не потрапляє — його точки тягаються кружечками в ConnectorShape; у
// групі з іншими він звичайний учасник
export function SelectionOverlay({
  nodesByIdRef,
  nodesVersion,
  objects,
  selectedIds,
  lockedByOthers,
  touchInput,
}: Props) {
  const colors = useCanvasColors();
  const transformerRef = useRef<Konva.Transformer>(null);
  // розмір і обведення на початку жесту — база для scaledStrokeWidth
  const strokeStartRef = useRef<Record<string, { strokeWidth: number; width: number; height: number }>>({});
  // весь стан жесту — лише те, що знято на його початку. Далі розмір і
  // позиція щокадру рахуються заново з цього запису й поточного курсора
  const gestureRef = useRef<ResizeGesture | null>(null);

  // konva теж рахує свою рамку (перейменовує активну ручку на відʼємній
  // стороні, робить із дзеркалення поворот 180°, довертає пропорцію по
  // гіпотенузі) — і саме ця внутрішня математика була джерелом усіх бід.
  // Поки жест наш, віддаємо їй стару рамку: тоді вона нічого не міняє, а
  // розмір виставляємо ми самі в onPointerMove. Для тексту й конектора
  // жест не наш — там konva працює як і раніше
  function limitBox(oldBox: Box, newBox: Box): Box {
    // наш жест: konva не міняє нічого, розмір виставляє resizeToPointer
    if (gestureRef.current) return oldBox;
    // текст і конектор веде konva. Їй не можна давати лише вироджену або
    // відʼємну рамку: на першій вона глушить увесь кадр і блок залипає
    // назавжди, а друга означала б дзеркалення — дзеркальний текст
    // читається навиворіт, тому для нього це просто нижня межа
    if (newBox.width < MIN_BOX_SIDE || newBox.height < MIN_BOX_SIDE) return oldBox;
    return newBox;
  }
  const updateObject = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  // окремо для ресайзу й для коміту трансформації: в одному кадрі можуть
  // прийти обидва, і спільна черга лишила б лише останнє
  const [resizeFrame] = useState(frameCoalescer);
  const [commitFrame] = useState(frameCoalescer);
  const setInteracting = useEditorStore((s) => s.setInteracting);
  // посеред жесту стор тепер оновлюється щокадру — а цей компонент від того
  // перемальовується і перечіпляє nodes() трансформера. Konva на setNodes
  // скидає власний rotation (для групи — у нуль), і кут починає накопичуватись.
  // Тому поки жест іде, трансформер не чіпаємо: набір виділених вузлів за цей
  // час не змінюється, а рамку konva й так тягне за вузлами сама
  const interacting = useEditorStore((s) => s.interacting);
  const [shiftHeld, setShiftHeld] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(true);
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') setShiftHeld(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // замкнений прапорцем сюди не потрапляє так само, як зайнятий іншим: ручок
  // розміру й повороту на ньому нема, хоч виділення й лишається
  const selectedObjects = selectedIds
    .map((id) => objects[id])
    .filter((o): o is BoardObject => !!o && isMovable(o, lockedByOthers));
  const soleText =
    selectedObjects.length === 1 && selectedObjects[0].type === 'text'
      ? (selectedObjects[0] as TextObject)
      : null;
  // одинокий конектор чи пряма ведуться власними кружечками кінців, тому
  // трансформер їм не даємо: дві рамки з ручками одна поверх одної лише
  // плутали б, та й тягнути лінію за кут рамки нема сенсу
  const soleConnector =
    selectedObjects.length === 1 &&
    (selectedObjects[0].type === 'connector' || selectedObjects[0].type === 'line');
  // картинку саму по собі тягнемо лише пропорційно, інакше вона сплющується
  const soleImage = selectedObjects.length === 1 && selectedObjects[0].type === 'image';
  // пропорція заблокована для тексту й картинки завжди, для решти — з shift
  const keepRatio = soleText || soleImage ? true : shiftHeld;
  const isSoleText = !!soleText;
  // нова функція щорендера означала б зміну атрибута трансформера і зайвий
  // update() на кожен кадр жесту
  const anchorStyleFunc = useMemo(() => anchorStyler(isSoleText, touchInput), [isSoleText, touchInput]);

  useEffect(() => {
    if (interacting) return;
    const nodesById = nodesByIdRef.current ?? {};
    const nodes = soleConnector
      ? []
      : selectedObjects.map((o) => nodesById[o.id]).filter((n): n is Konva.Node => !!n);
    transformerRef.current?.nodes(nodes);
    // після коміту трансформації рамку треба перерахувати ще раз: для групи
    // (стікер, текст) зміна width у дитини-Rect не генерує подій на самій
    // групі, і трансформер лишається зі старою геометрією — тому objects у deps
    transformerRef.current?.forceUpdate();
    transformerRef.current?.getLayer()?.batchDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(','), shiftHeld, nodesVersion, objects, interacting, lockedByOthers]);

  // обведення рахуємо від того, що було на ПОЧАТКУ жесту, а не від
  // попереднього кадру: інакше кожен кадр множить попередній результат, і
  // один прохід біля нуля (де розмір лягає на поріг) розганяє товщину до
  // максимуму за два-три перетини
  function rememberTransformStart() {
    const start: Record<string, { strokeWidth: number; width: number; height: number }> = {};
    for (const o of selectedObjects) {
      if (o.type === 'shape') start[o.id] = { strokeWidth: o.strokeWidth, width: o.width, height: o.height };
    }
    strokeStartRef.current = start;
    gestureRef.current = beginResize();
    if (gestureRef.current) {
      // слухаємо рух САМІ, а не покладаємось на подію konva: вона не шле
      // 'transform', коли її власна рамка виходить виродженою (|ширина| < 1),
      // а це рівно ті кадри біля нерухомої точки, де й відбувається переворот
      window.addEventListener('pointermove', handlePointerMove);
    }
    setInteracting(true);
  }

  function handlePointerMove(e: PointerEvent) {
    // konva тримає позицію вказівника у себе — оновлюємо її перед читанням
    transformerRef.current?.getStage()?.setPointersPositions(e);
    // розмір рахується з курсора з нуля, тож проміжні події кадру нічого не
    // додають — лише зайві пакети. вузол і стор оновлюються разом, раз на кадр
    resizeFrame.schedule(resizeToPointer);
  }

  // все, що потрібно на весь жест, знімаємо тут і більше не перераховуємо
  function beginResize(): ResizeGesture | null {
    const tr = transformerRef.current;
    const handle = tr?.getActiveAnchor();
    // поворот іде своїм шляхом, і текст із конектором теж
    if (!tr || !handle || handle === 'rotater') return null;
    const pointer = tr.getStage()?.getRelativePointerPosition();
    if (!pointer) return null;

    // одинокий текст веде та сама математика, але з власним тлумаченням
    // результату: кут — це шрифт, ребро — ширина переносу
    if (soleText) {
      const from = { x: soleText.x, y: soleText.y, width: soleText.width, height: soleText.height };
      const grabbed = handlePoint(from, handle, soleText.rotation);
      return {
        grip: gripFor(from, soleText.rotation, handle),
        from,
        // кутом тягнемо шрифт — там обидві осі разом; ребром лише одну
        lockRatio: isCornerHandle(handle),
        grabOffset: { x: pointer.x - grabbed.x, y: pointer.y - grabbed.y },
        items: [{ id: soleText.id, start: from, flipX: false, flipY: false }],
        handle,
        text: {
          fontSize: soleText.fontSize,
          minHeight: soleText.minHeight,
          autoWidth: soleText.autoWidth,
          width: soleText.width,
          height: soleText.height,
        },
      };
    }

    const rects = selectedObjects.filter(isRectObject);
    if (rects.length === 0 || rects.length !== selectedObjects.length) return null;

    const from = unionRect(rects);
    // поворот враховуємо лише для одинокого обʼєкта: у групи в рамки свій кут
    const rotation = rects.length === 1 ? rects[0].rotation : 0;
    // і центр повороту — той самий, навколо якого konva крутить цей обʼєкт
    const pivot = rects.length === 1 ? pivotOffset(rects[0]) : { x: 0, y: 0 };
    const grabbed = handlePoint(from, handle, rotation, pivot);
    return {
      grip: gripFor(from, rotation, handle, pivot),
      from,
      lockRatio: keepRatio,
      grabOffset: { x: pointer.x - grabbed.x, y: pointer.y - grabbed.y },
      items: rects.map((o) => ({
        id: o.id,
        start: { x: o.x, y: o.y, width: o.width, height: o.height },
        flipX: o.type === 'image' ? (o.flipX ?? false) : false,
        flipY: o.type === 'image' ? (o.flipY ?? false) : false,
      })),
      handle,
      text: null,
    };
  }

  // щокадру: беремо курсор і рахуємо з нуля. Ні попередній кадр, ні рамка
  // konva, ні scale вузла тут не читаються
  function resizeToPointer() {
    const gesture = gestureRef.current;
    const tr = transformerRef.current;
    const stage = tr?.getStage();
    if (!gesture || !tr || !stage) return;
    const raw = stage.getRelativePointerPosition();
    if (!raw) return;
    const pointer = { x: raw.x - gesture.grabOffset.x, y: raw.y - gesture.grabOffset.y };
    const box = resizeFromPointer(
      gesture.grip,
      pointer,
      gesture.lockRatio,
      gesture.text ? MIN_BOX_SIDE : MIN_SIZE,
    );

    if (gesture.text) {
      resizeTextToBox(gesture, box);
      flushUpdates();
      tr.forceUpdate();
      tr.getLayer()?.batchDraw();
      return;
    }

    for (const item of gesture.items) {
      const obj = objects[item.id];
      const node = nodesByIdRef.current?.[item.id];
      if (!obj || !node || !isRectObject(obj)) continue;
      const placed = mapIntoBox(item.start, gesture.from, box);
      const rect = toModelRect(
        placed,
        gesture.grip.rotation,
        pivotOffset({ ...obj, width: placed.width, height: placed.height }),
      );
      applyRect(node, obj, rect, box);
      updateObject(item.id, storePatch(obj, item, rect, box));
    }
    flushUpdates();
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }

  // Текст читає ту саму рамку, але тлумачить її по-своєму, і з двома
  // власними правилами.
  //
  // Перше: вміст НІКОЛИ не малюється дзеркально. Тому тут ніде немає ні
  // відʼємного scale, ні повороту — гліфи завжди йдуть зліва направо й
  // верхом угору. Горизонтально сама РАМКА переїхати за нерухому точку
  // може (це звичайний resize у протилежний бік), а от літери в ній — ні.
  //
  // Друге: по вертикалі текст не перевертається взагалі, навіть коли
  // фігура на його місці перевернулась би. Тому верхній край завжди беремо
  // з «нормального» боку нерухомої точки, а mirroredY просто ігноруємо —
  // по висоті лишається звичайна поведінка тексту (мінімум під вміст)
  function resizeTextToBox(gesture: ResizeGesture, box: ResizeResult) {
    const start = gesture.text;
    const obj = objects[gesture.items[0].id];
    const node = nodesByIdRef.current?.[gesture.items[0].id];
    if (!start || !obj || obj.type !== 'text' || !node) return;
    const group = node as Konva.Group;
    const boxRect = group.findOne<Konva.Rect>('.box');
    const textNode = group.findOne<Konva.Text>('.text');
    if (!boxRect || !textNode) return;

    let patch: Partial<TextObject>;
    if (gesture.handle === 'bottom-center') {
      patch = { minHeight: box.height };
    } else if (isEdgeAnchor(gesture.handle)) {
      patch = { width: box.width, autoWidth: false };
    } else {
      // кут: рамка тягне розмір шрифту. Множник один на обидві осі, бо для
      // тексту resizeFromPointer викликано з заблокованою пропорцією
      const scale = box.width / start.width;
      patch = {
        fontSize: clamp(Math.round(start.fontSize * scale), FONT_SIZE_MIN, FONT_SIZE_MAX),
        width: start.autoWidth ? obj.width : Math.max(MIN_SIZE, start.width * scale),
        minHeight: start.minHeight * scale,
      };
    }
    const size = fitTextBox({ ...obj, ...patch });

    // горизонталь: рамка стоїть тим боком нерухомої точки, у який пішов
    // курсор. Вертикаль: завжди «нормальним» боком — дзеркалення немає
    const grip = gesture.grip;
    const extendsRight = box.x >= grip.x - 1e-9;
    const x = extendsRight ? grip.x : grip.x - size.width;
    const y = grip.signY > 0 ? grip.y : grip.y - size.height;

    group.scale({ x: 1, y: 1 });
    group.setAttrs({ x, y });
    textNode.fontSize(patch.fontSize ?? obj.fontSize);
    if (!(patch.autoWidth ?? obj.autoWidth)) textNode.width(size.width);
    boxRect.setAttrs(size);
    updateObject(obj.id, { x, y, ...patch, ...size });
  }

  // вузол приводимо рівно до порахованого. scale завжди лишається 1 — його
  // не читають і не використовують ніде
  function applyRect(node: Konva.Node, obj: RectObject, rect: Rect, box: ResizeResult) {
    node.scale({ x: 1, y: 1 });
    if (obj.type === 'shape') {
      const strokeWidth = scaledStrokeWidth(strokeStartRef.current[obj.id] ?? obj, rect);
      if (obj.shapeKind === 'ellipse') {
        // Ellipse малюється від центру, модель тримає лівий верхній кут
        node.setAttrs({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          radiusX: rect.width / 2,
          radiusY: rect.height / 2,
          strokeWidth,
        });
      } else {
        node.setAttrs({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, strokeWidth });
      }
      return;
    }
    if (obj.type === 'image') {
      node.setAttrs({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      return;
    }
    const group = node as Konva.Group;
    group.setAttrs({ x: rect.x, y: rect.y });
    group.findOne<Konva.Rect>('.box')?.setAttrs({ width: rect.width, height: rect.height });
    group.findOne<Konva.Text>('.text')?.setAttrs({
      width: Math.max(0, rect.width - STICKY_PADDING * 2),
      height: Math.max(0, rect.height - STICKY_PADDING * 2),
    });
    void box;
  }

  function storePatch(obj: RectObject, item: ResizeGesture['items'][number], rect: Rect, box: ResizeResult) {
    const common = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (obj.type === 'shape') {
      return { ...common, strokeWidth: scaledStrokeWidth(strokeStartRef.current[obj.id] ?? obj, rect) };
    }
    if (obj.type === 'image') {
      // дзеркалення цього жесту накладаємо на те, що було до нього: сам факт
      // перевороту щокадру рахується наново з курсора, а попередній стан
      // картинки при цьому не губиться
      return {
        ...common,
        flipX: item.flipX !== box.mirroredX,
        flipY: item.flipY !== box.mirroredY,
      };
    }
    return common;
  }

  // на кожному кадрі тягання scale вузла одразу запікається в його розмір,
  // тож нода ніколи не несе scale: обведення не сплющується по осях (konva
  // масштабує stroke тією ж матрицею), стікер переносить текст наживо, у
  // тексту росте сам шрифт замість розтягування гліфів, а конектор
  // переносить трансформацію в самі точки
  function handleTransform(e: KonvaEventObject<Event>) {
    const tr = transformerRef.current;
    if (!tr) return;
    const anchor = tr.getActiveAnchor();
    for (const node of tr.nodes()) {
      const obj = objects[node.id()];
      if (!obj) continue;
      if (isRectObject(obj)) {
        // ці рахує resizeToPointer за курсором; konva тут не бере участі
        continue;
      }
      if (obj.type === 'text' && gestureRef.current?.text) {
        // одинокий текст веде resizeTextToBox за курсором
        continue;
      }
      if (obj.type === 'text' && soleText && isEdgeAnchor(anchor)) {
        resizeTextLive(node as Konva.Group, anchor, soleText.minHeight);
      } else if (obj.type === 'text') {
        scaleTextLive(node as Konva.Group, obj.autoWidth);
      } else if (obj.type === 'connector' || obj.type === 'line') {
        bakeConnectorTransform(node as Konva.Group);
      }
    }
    // і одразу в стор — інакше інші бачать не зміну розміру, а стрибок у
    // кінцевий стан. Безпечно це стало тоді, коли ефект з nodes() перестав
    // перечіплювати трансформер посеред жесту (див. interacting у його умові):
    // раніше setNodes скидав власний rotation трансформера, і кут накопичувався.
    // konva шле 'transform' по разу на кожен вузол за кадр, а цикл вище й так
    // проходить усі — пишемо лише на першому, інакше для групи з N виходить
    // N² оновлень і стільки ж пакетів у мережу.
    //
    // І одразу ж скидаємо в документ, не чекаючи наступного кадру. Бо інакше
    // стор відстає від вузла на кадр, react перемальовує вузол уже застарілими
    // числами — і виходить кадр, де x новий, а width ще старий. На плавному
    // тяганні це непомітно, а на межі приніжної зони пара розʼїжджається на
    // піксель, і «нерухомий» кут смикається. Пакет той самий один на кадр,
    // просто закривається тут, а не в rAF
    if (e.target === tr.nodes()[0]) {
      // у стратегії batched — раз на кадр, останнім станом вузлів
      commitFrame.schedule(() => {
        commitNodes();
        flushUpdates();
      });
    }
  }

  function handleTransformEnd() {
    window.removeEventListener('pointermove', handlePointerMove);
    resizeFrame.flush();
    commitFrame.flush();
    if (gestureRef.current) resizeToPointer();
    commitNodes();
    flushUpdates();
    strokeStartRef.current = {};
    gestureRef.current = null;
    setInteracting(false);
  }

  // те саме тіло, що й було в handleTransformEnd: розмір/кут/позиція вузлів —
  // у стор. Викликається і щокадру, і в кінці жесту
  function commitNodes() {
    const tr = transformerRef.current;
    if (!tr) return;
    for (const node of tr.nodes()) {
      const obj = objects[node.id()];
      if (!obj) continue;

      if (obj.type === 'connector') {
        // handleTransform уже переніс усе в точки вузла, тут фіксуємо в сторі
        updateObject(obj.id, withPoints(bakeConnectorTransform(node as Konva.Group)));
        continue;
      }

      // у прямої та сама механіка, лише кінців рівно два
      if (obj.type === 'line') {
        const [from, to] = bakeConnectorTransform(node as Konva.Group);
        if (from && to) updateObject(obj.id, withEnds(from, to));
        continue;
      }

      const common = { x: node.x(), y: node.y(), rotation: node.rotation() };

      if (obj.type === 'text') {
        // одинокий текст уже записав resizeTextToBox; у групі його й далі
        // веде konva, тому там дочитуємо з вузла як раніше
        if (!gestureRef.current?.text) {
          updateObject(obj.id, {
            ...common,
            ...textPatch(obj, node as Konva.Group, tr.getActiveAnchor(), !!soleText),
          });
        }
        continue;
      }

      // ресайз прямокутних уже записав resizeToPointer. а от чистий поворот
      // веде сама konva (beginResize на rotater дає null) — без цього кут
      // лишався тільки на вузлі й губився при перезаході
      if (!gestureRef.current) {
        // вузол еліпса стоїть у центрі, модель — у лівому верхньому куті
        const pivot = pivotOffset(obj);
        updateObject(obj.id, { ...common, x: common.x - pivot.x, y: common.y - pivot.y });
      }
    }
  }

  return (
    <Transformer
      ref={transformerRef}
      // рамку трансформера рахуємо БЕЗ обведення: інакше воно входить у
      // розміри, і заблокована пропорція щожесту трохи повзе до квадрата
      // (у виділеної картинки обведення 3px — це +6 до кожної сторони)
      ignoreStroke
      boundBoxFunc={limitBox}
      enabledAnchors={soleText ? TEXT_ANCHORS : soleImage ? CORNER_ANCHORS : ALL_ANCHORS}
      anchorStyleFunc={anchorStyleFunc}
      keepRatio={keepRatio}
      rotateEnabled
      onTransformStart={rememberTransformStart}
      onTransform={handleTransform}
      onTransformEnd={handleTransformEnd}
      anchorSize={ANCHOR_SIZE}
      borderStroke={colors.accent}
      anchorStroke={colors.accent}
      anchorStrokeWidth={1.5}
      anchorCornerRadius={6}
      anchorFill="#fff"
      rotateAnchorOffset={28}
    />
  );
}

// що саме змінила трансформація текстового блоку: ребро одиночного — межа
// ширини або мінімальна висота, кут чи групове виділення — розмір шрифту.
// handleTransform усе це вже виставив на вузлі, тут лише дочитуємо і
// перераховуємо розмір блоку під вміст
function textPatch(obj: TextObject, node: Konva.Group, anchor: string | null, sole: boolean) {
  const box = node.findOne<Konva.Rect>('.box');
  const text = node.findOne<Konva.Text>('.text');
  if (!box || !text) return {};
  let patch: Partial<TextObject>;
  if (sole && anchor === 'bottom-center') {
    patch = { minHeight: box.height() };
  } else if (sole && isEdgeAnchor(anchor)) {
    patch = { width: box.width(), autoWidth: false };
  } else {
    patch = {
      fontSize: clamp(Math.round(text.fontSize()), FONT_SIZE_MIN, FONT_SIZE_MAX),
      width: obj.autoWidth ? obj.width : Math.max(MIN_SIZE, box.width()),
      minHeight: (obj.minHeight * text.fontSize()) / obj.fontSize,
    };
  }
  const size = fitTextBox({ ...obj, ...patch });
  // вузол приводимо до того, що комітимо: якщо значення в сторі не змінилось
  // (округлений fontSize той самий), react його на вузлі не перевиставить
  text.fontSize(patch.fontSize ?? obj.fontSize);
  if (!(patch.autoWidth ?? obj.autoWidth)) text.width(size.width);
  box.setAttrs(size);
  return { ...patch, ...size };
}

// текст у групі чи за кут: масштаб по y стає розміром шрифту, по x — шириною
// блоку; scale скидаємо щокадру, інакше гліфи сплющуються по осях
function scaleTextLive(node: Konva.Group, autoWidth: boolean) {
  const box = node.findOne<Konva.Rect>('.box');
  const text = node.findOne<Konva.Text>('.text');
  if (!box || !text) return;
  const sx = node.scaleX();
  const sy = node.scaleY();
  node.scale({ x: 1, y: 1 });
  text.fontSize(clamp(text.fontSize() * sy, FONT_SIZE_MIN, FONT_SIZE_MAX));
  const width = textSide(box.width(), sx);
  box.setAttrs({ width, height: textSide(box.height(), sy) });
  if (!autoWidth) text.width(width);
}

// точки конектора абсолютні, а трансформер крутить/тягне групу: проганяємо
// її матрицю через точки й скидаємо групу в нейтраль — інакше stroke
// сплющиться, а наступне тягання здвоїть зсув (те саме, що в handleDragEnd)
function bakeConnectorTransform(node: Konva.Group): BoardPoint[] {
  const line = node.findOne<Konva.Line>('.line');
  if (!line) return [];
  const matrix = node.getTransform();
  const flat = line.points();
  const points: BoardPoint[] = [];
  for (let i = 0; i < flat.length; i += 2) points.push(matrix.point({ x: flat[i], y: flat[i + 1] }));
  line.points(flattenPoints(points));
  node.setAttrs({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 });
  return points;
}

// текст і далі тягне konva (у нього розмір — це шрифт і перенос, а не
// прямокутник), тому тут scale вузла ще читається. Модуль лишаємо як
// страховку: від konva може прилетіти відʼємний scale на дзеркаленні
function textSide(size: number, scale: number) {
  return Math.max(MIN_BOX_SIDE, Math.abs(size * scale));
}

// тягання ребра тексту: скидаємо scale одразу і задаємо ширину — konva
// переносить рядки наживо замість стискати гліфи; висота завжди не менша за вміст
function resizeTextLive(node: Konva.Group, anchor: string | null, minHeight: number) {
  const box = node.findOne<Konva.Rect>('.box');
  const text = node.findOne<Konva.Text>('.text');
  if (!box || !text) return;
  const width = textSide(box.width(), node.scaleX());
  const height = textSide(box.height(), node.scaleY());
  node.scale({ x: 1, y: 1 });
  // висота теж не нижче порога: у вузькому блоці konva міряє порожній текст
  // у 0, і рамка виділення стає виродженою. Далі конва бачить нульову
  // сторону, кидає весь кадр своєю ж перевіркою — і блок залипає назавжди
  if (anchor === 'bottom-center') {
    box.height(Math.max(height, text.height(), MIN_BOX_SIDE));
  } else {
    box.width(width);
    text.setAttrs({ width, wrap: 'word' });
    box.height(Math.max(text.height(), minHeight, MIN_BOX_SIDE));
  }
}
