import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { RefObject } from 'react';
import type { BoardObject, BoardPoint, ImageObject, ShapeObject, StickyObject, TextObject } from 'shared';
import type { Box } from 'konva/lib/shapes/Transformer';
import type { Point } from '../coordinates';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../object-defaults';
import { fitTextBox } from '../text-layout';
import { flattenPoints, withPoints } from './connector-geometry';
import {
  MIN_SIZE,
  bakedSide,
  fixedCornerOf,
  isCornerAnchor,
  isResizeAnchor,
  limitBoxSize,
  scaledStrokeWidth,
} from './transform-math';

const STICKY_PADDING = 10; // те саме, що відступ тексту в StickyNoteShape
const ANCHOR_SIZE = 12;
// ширина невидимої смужки захвату вздовж ребра текстового блоку (px екрана)
const EDGE_GRAB_PX = 10;

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
function styleTextAnchor(anchor: Konva.Rect) {
  const name = anchor.name().split(' ')[0];
  const tr = anchor.getParent() as Konva.Transformer;
  const w = Math.abs(tr.width());
  const h = Math.abs(tr.height());
  if (name === 'middle-left' || name === 'middle-right') {
    // коротша за ребро на розмір кутів, інакше перекриває кутові ручки
    const len = Math.max(0, h - ANCHOR_SIZE * 2);
    anchor.setAttrs({
      width: EDGE_GRAB_PX,
      height: len,
      offsetX: EDGE_GRAB_PX / 2,
      offsetY: len / 2,
      fill: 'transparent',
      stroke: 'transparent',
    });
  } else if (name === 'bottom-center') {
    const len = Math.max(0, w - ANCHOR_SIZE * 2);
    anchor.setAttrs({
      width: len,
      height: EDGE_GRAB_PX,
      offsetX: len / 2,
      offsetY: EDGE_GRAB_PX / 2,
      fill: 'transparent',
      stroke: 'transparent',
    });
  }
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
}: Props) {
  const transformerRef = useRef<Konva.Transformer>(null);
  // розмір і обведення на початку жесту — база для scaledStrokeWidth
  const strokeStartRef = useRef<Record<string, { strokeWidth: number; width: number; height: number }>>({});
  // ручка, за яку взялись, і протилежний їй кут. Кут беремо на першому кадрі
  // жесту (там рамка ще не чіпана) і тримаємо до кінця — на нього спирається
  // вся рамка, і саме тому в приніжній зоні вона не зсувається
  const grabbedAnchorRef = useRef<string | null>(null);
  const fixedCornerRef = useRef<Point | null>(null);

  // konva перейменовує активну ручку, щойно сторона стає відʼємною, тому
  // питати її імʼя тут, посеред жесту, вже не можна — беремо запамʼятоване
  function limitBox(oldBox: Box, newBox: Box): Box {
    if (!isResizeAnchor(grabbedAnchorRef.current)) return newBox;
    if (!fixedCornerRef.current) {
      fixedCornerRef.current = fixedCornerOf(oldBox, grabbedAnchorRef.current);
    }
    // пропорція заблокована лише на кутах: ребром тягнуть одну вісь, і
    // друга тут ні до чого
    const locked = keepRatio && isCornerAnchor(grabbedAnchorRef.current);
    return limitBoxSize(fixedCornerRef.current, newBox, locked);
  }
  const updateObject = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
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

  const selectedObjects = selectedIds
    .map((id) => objects[id])
    .filter((o): o is BoardObject => !!o && !lockedByOthers.has(o.id));
  const soleText =
    selectedObjects.length === 1 && selectedObjects[0].type === 'text'
      ? (selectedObjects[0] as TextObject)
      : null;
  const soleConnector = selectedObjects.length === 1 && selectedObjects[0].type === 'connector';
  // картинку саму по собі тягнемо лише пропорційно, інакше вона сплющується
  const soleImage = selectedObjects.length === 1 && selectedObjects[0].type === 'image';
  // пропорція заблокована для тексту й картинки завжди, для решти — з shift
  const keepRatio = soleText || soleImage ? true : shiftHeld;

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
    grabbedAnchorRef.current = transformerRef.current?.getActiveAnchor() ?? null;
    fixedCornerRef.current = null;
    setInteracting(true);
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
      if (obj.type === 'shape' || obj.type === 'sticky' || obj.type === 'image') {
        const size = bakeScale(node, obj);
        if (obj.type === 'shape') node.setAttrs({ strokeWidth: scaledStrokeWidth(strokeStartRef.current[obj.id] ?? obj, size) });
      } else if (obj.type === 'text' && soleText && isEdgeAnchor(anchor)) {
        resizeTextLive(node as Konva.Group, anchor, soleText.minHeight);
      } else if (obj.type === 'text') {
        scaleTextLive(node as Konva.Group, obj.autoWidth);
      } else if (obj.type === 'connector') {
        bakeConnectorTransform(node as Konva.Group);
      }
    }
    // і одразу в стор — інакше інші бачать не зміну розміру, а стрибок у
    // кінцевий стан. Безпечно це стало тоді, коли ефект з nodes() перестав
    // перечіплювати трансформер посеред жесту (див. interacting у його умові):
    // раніше setNodes скидав власний rotation трансформера, і кут накопичувався.
    // konva шле 'transform' по разу на кожен вузол за кадр, а цикл вище й так
    // проходить усі — пишемо лише на першому, інакше для групи з N виходить
    // N² оновлень і стільки ж пакетів у мережу
    if (e.target === tr.nodes()[0]) commitNodes();
  }

  function handleTransformEnd() {
    commitNodes();
    flushUpdates();
    strokeStartRef.current = {};
    grabbedAnchorRef.current = null;
    fixedCornerRef.current = null;
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

      // scale тут уже 1 (запечений у handleTransform): розмір комітимо як
      // width/height, а React scale не чіпає — інакше нода й пропси розійдуться
      const common = { x: node.x(), y: node.y(), rotation: node.rotation() };

      if (obj.type === 'text') {
        updateObject(obj.id, {
          ...common,
          ...textPatch(obj, node as Konva.Group, tr.getActiveAnchor(), !!soleText),
        });
        continue;
      }

      // handleTransform уже запік scale у розмір — тут лише дочитуємо його з вузла
      const { width, height } = bakeScale(node, obj);
      if (obj.type === 'shape') {
        const strokeWidth = scaledStrokeWidth(strokeStartRef.current[obj.id] ?? obj, { width, height });
        if (obj.shapeKind === 'ellipse') {
          // Ellipse позиціюється від центру — модель тримає top-left
          updateObject(obj.id, {
            ...common,
            width,
            height,
            strokeWidth,
            x: node.x() - width / 2,
            y: node.y() - height / 2,
          });
        } else {
          updateObject(obj.id, { ...common, width, height, strokeWidth });
        }
        continue;
      }
      updateObject(obj.id, { ...common, width, height });
    }
  }

  return (
    <Transformer
      ref={transformerRef}
      boundBoxFunc={limitBox}
      enabledAnchors={soleText ? TEXT_ANCHORS : soleImage ? CORNER_ANCHORS : ALL_ANCHORS}
      anchorStyleFunc={soleText ? styleTextAnchor : undefined}
      keepRatio={keepRatio}
      rotateEnabled
      onTransformStart={rememberTransformStart}
      onTransform={handleTransform}
      onTransformEnd={handleTransformEnd}
      anchorSize={ANCHOR_SIZE}
      borderStroke="#4262ff"
      anchorStroke="#4262ff"
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
  const width = bakedSide(box.width(), sx);
  box.setAttrs({ width, height: bakedSide(box.height(), sy) });
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

// переносить scale вузла в його справжній розмір (width/height, радіуси,
// діти групи стікера) і повертає новий розмір у координатах дошки.
// знак тут уже не зустрічається: limitBoxSize нормалізує рамку ще в
// координатах конви, тому scale приходить лише додатний. modulo в bakedSide
// лишається як страховка — краще зайвий раз узяти модуль, ніж отримати
// відʼємну ширину у вузлі
function bakeScale(node: Konva.Node, obj: ShapeObject | StickyObject | ImageObject) {
  const sx = node.scaleX();
  const sy = node.scaleY();
  node.scale({ x: 1, y: 1 });
  if (obj.type === 'shape' && obj.shapeKind === 'ellipse') {
    const ellipse = node as Konva.Ellipse;
    const radiusX = Math.max(MIN_SIZE / 2, Math.abs(ellipse.radiusX() * sx));
    const radiusY = Math.max(MIN_SIZE / 2, Math.abs(ellipse.radiusY() * sy));
    ellipse.setAttrs({ radiusX, radiusY });
    return { width: radiusX * 2, height: radiusY * 2 };
  }
  if (obj.type === 'shape' || obj.type === 'image') {
    const width = bakedSide(node.width(), sx);
    const height = bakedSide(node.height(), sy);
    node.setAttrs({ width, height });
    return { width, height };
  }
  const box = (node as Konva.Group).findOne<Konva.Rect>('.box');
  const text = (node as Konva.Group).findOne<Konva.Text>('.text');
  const width = bakedSide(box?.width() ?? obj.width, sx);
  const height = bakedSide(box?.height() ?? obj.height, sy);
  box?.setAttrs({ width, height });
  // на мінімальному розмірі відступи більші за сам стікер — але відʼємної
  // ширини konva-тексту давати не можна
  text?.setAttrs({
    width: Math.max(0, width - STICKY_PADDING * 2),
    height: Math.max(0, height - STICKY_PADDING * 2),
  });
  return { width, height };
}

// тягання ребра тексту: скидаємо scale одразу і задаємо ширину — konva
// переносить рядки наживо замість стискати гліфи; висота завжди не менша за вміст
function resizeTextLive(node: Konva.Group, anchor: string | null, minHeight: number) {
  const box = node.findOne<Konva.Rect>('.box');
  const text = node.findOne<Konva.Text>('.text');
  if (!box || !text) return;
  const width = bakedSide(box.width(), node.scaleX());
  const height = bakedSide(box.height(), node.scaleY());
  node.scale({ x: 1, y: 1 });
  // висота теж не нижче порога: у вузькому блоці konva міряє порожній текст
  // у 0, і рамка виділення стає виродженою. Далі конва бачить нульову
  // сторону, кидає весь кадр своєю ж перевіркою — і блок залипає назавжди
  if (anchor === 'bottom-center') {
    box.height(Math.max(height, text.height(), MIN_SIZE));
  } else {
    box.width(width);
    text.setAttrs({ width, wrap: 'word' });
    box.height(Math.max(text.height(), minHeight, MIN_SIZE));
  }
}
