import { useEffect, useMemo, useRef, useState } from 'react';
import { Ellipse, Layer, Line, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Grid } from './Grid';
import { TextEditOverlay } from './TextEditOverlay';
import { useBoardStore } from './board-store';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { ObjectRenderer } from './objects/ObjectRenderer';
import { SelectionOverlay } from './objects/SelectionOverlay';
import { useObjectInteractions } from './useObjectInteractions';

interface StageHandlers {
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onMouseDown: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: KonvaEventObject<MouseEvent>) => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void;
  onTouchStart: (e: KonvaEventObject<TouchEvent>) => void;
  onTouchMove: (e: KonvaEventObject<TouchEvent>) => void;
  onTouchEnd: (e: KonvaEventObject<TouchEvent>) => void;
}

interface Props {
  viewport: Viewport;
  spaceHeld: boolean;
  stageHandlers: StageHandlers;
  onSizeChange: (size: { width: number; height: number }) => void;
  currentUserId: string;
}

// суто відображення — пан/зум живуть у useCanvasViewport, обʼєкти й
// виділення — у useObjectInteractions + board-store/editor-store; цей
// компонент лише міряє розмір, малює Stage і зводить усі обробники разом
export function BoardCanvas({ viewport, spaceHeld, stageHandlers, onSizeChange, currentUserId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const nodesById = useRef<Record<string, Konva.Node>>({});
  // клік по Stage (add+select обʼєкта) — це нативний Konva-обробник поза React-подіями,
  // тому оновлення board-store і editor-store іноді потрапляють у РІЗНІ коміти:
  // SelectionOverlay встигає прочитати nodesById.current до того, як щойно змонтований
  // вузол устиг туди дописатись. nodesVersion змушує SelectionOverlay перечепитись,
  // щойно вузол реально зареєструвався — незалежно від того, в якому коміті це сталось
  const [nodesVersion, setNodesVersion] = useState(0);
  // registerRef має бути тим самим об'єктом функції між рендерами для того самого
  // id — інакше React бачить "нову" ref-функцію на кожен рендер (наприклад, коли
  // міняється лише виділення) і зайвий раз відчіплює/чіпляє Konva-вузол
  const registerRefCache = useRef<Map<string, (node: Konva.Node | null) => void>>(new Map());
  function getRegisterRef(id: string) {
    let fn = registerRefCache.current.get(id);
    if (!fn) {
      fn = (node) => {
        if (node) nodesById.current[id] = node;
        else delete nodesById.current[id];
        setNodesVersion((v) => v + 1);
      };
      registerRefCache.current.set(id, fn);
    }
    return fn;
  }

  const activeTool = useEditorStore((s) => s.activeTool);
  const canEdit = useEditorStore((s) => s.canEdit);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const objectsMap = useBoardStore((s) => s.objects);
  const editingObject = editingTextId ? objectsMap[editingTextId] : undefined;

  const { rubberBand, draft, handleStageMouseDown, handleStageClick, handleStageTap } = useObjectInteractions(
    viewport,
    containerRef,
    currentUserId,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      onSizeChange({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSizeChange]);

  const sortedObjects = useMemo(
    () => Object.values(objectsMap).sort((a, b) => a.zIndex - b.zIndex),
    [objectsMap],
  );

  // прибираємо закешовані registerRef для вже видалених обʼєктів
  useEffect(() => {
    for (const id of registerRefCache.current.keys()) {
      if (!(id in objectsMap)) {
        registerRefCache.current.delete(id);
        delete nodesById.current[id];
      }
    }
  }, [objectsMap]);

  // глядачу тягати не можна ніколи, незалежно від інструмента
  const draggableObjects = canEdit && activeTool === 'select';

  function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
    stageHandlers.onMouseDown(e);
    handleStageMouseDown(e);
  }

  const cursor = spaceHeld ? 'grab' : activeTool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={containerRef} className="board-canvas" style={{ cursor }}>
      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          onWheel={stageHandlers.onWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={stageHandlers.onMouseUp}
          onContextMenu={stageHandlers.onContextMenu}
          onTouchStart={stageHandlers.onTouchStart}
          onTouchMove={stageHandlers.onTouchMove}
          onTouchEnd={stageHandlers.onTouchEnd}
          onClick={handleStageClick}
          onTap={handleStageTap}
        >
          <Layer listening={false}>
            <Grid viewport={viewport} width={size.width} height={size.height} />
          </Layer>

          <Layer>
            {/* eslint-disable-next-line react-hooks/refs -- getRegisterRef читає
            registerRefCache.current лише для кешування функції за id, не для
            виводу в рендер; без кешу React бачив би нову ref-функцію щоразу */}
            {sortedObjects.map((object) => (
              <ObjectRenderer
                key={object.id}
                object={object}
                isSelected={selectedIds.includes(object.id)}
                isEditing={editingTextId === object.id}
                draggable={draggableObjects}
                viewportScale={viewport.scale}
                registerRef={getRegisterRef(object.id)}
              />
            ))}

            {draft && <DraftPreview tool={draft.tool} start={draft.start} current={draft.current} />}
            {rubberBand && <RubberBandRect start={rubberBand.start} current={rubberBand.current} />}
          </Layer>

          {/* трансформер глядачу не малюємо — ручки без дії лише плутали б;
          виділення йому показує сама фігура своїм обведенням */}
          {canEdit && (
            <Layer listening={draggableObjects}>
              <SelectionOverlay
                nodesByIdRef={nodesById}
                nodesVersion={nodesVersion}
                objects={objectsMap}
                selectedIds={selectedIds}
              />
            </Layer>
          )}
        </Stage>
      )}
      {editingObject && <TextEditOverlay object={editingObject} viewport={viewport} />}
    </div>
  );
}

function RubberBandRect({
  start,
  current,
}: {
  start: { x: number; y: number };
  current: { x: number; y: number };
}) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return (
    <Rect
      x={x}
      y={y}
      width={Math.abs(current.x - start.x)}
      height={Math.abs(current.y - start.y)}
      fill="rgba(66, 98, 255, 0.08)"
      stroke="#4262ff"
      strokeWidth={1}
      dash={[4, 4]}
      listening={false}
    />
  );
}

function DraftPreview({
  tool,
  start,
  current,
}: {
  tool: 'rect' | 'ellipse' | 'connector';
  start: { x: number; y: number };
  current: { x: number; y: number };
}) {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);

  if (tool === 'ellipse') {
    return (
      <Ellipse
        x={x + width / 2}
        y={y + height / 2}
        radiusX={width / 2}
        radiusY={height / 2}
        stroke="#4262ff"
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  if (tool === 'connector') {
    return (
      <Line
        points={[start.x, start.y, current.x, current.y]}
        stroke="#4262ff"
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  return <Rect x={x} y={y} width={width} height={height} stroke="#4262ff" dash={[6, 4]} listening={false} />;
}
