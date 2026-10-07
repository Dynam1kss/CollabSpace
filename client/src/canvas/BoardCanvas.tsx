import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Ellipse, Layer, Line, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Grid } from './Grid';
import { TextEditOverlay } from './TextEditOverlay';
import { useBoardStore } from './board-store';
import { exportFrame, exportTargets } from './board-export';
import type { ExportFrame } from './board-export';
import { getVisibleBoardRect, screenToBoard } from './coordinates';
import type { Point, Viewport } from './coordinates';
import { objectsListen, useEditorStore } from './editor-store';
import { contentBounds } from './fit-to-objects';
import { ObjectRenderer } from './objects/ObjectRenderer';
import { UploadPlaceholders } from './objects/UploadPlaceholders';
import { RemoteCursors } from './objects/RemoteCursors';
import { LockedBadges } from './objects/LockedBadges';
import { RemoteLocks } from './objects/RemoteLocks';
import { RemoteSelections } from './objects/RemoteSelections';
import { RemoteViewports } from './objects/RemoteViewports';
import { SelectionOverlay } from './objects/SelectionOverlay';
import { publishCursor, publishViewport } from './presence-channel';
import { isMovable } from './object-lock';
import { useLockedByOthers } from './presence-store';
import { useObjectInteractions } from './useObjectInteractions';
import { useImageDrop } from './use-image-drop';
import { useLinkPaste } from './use-link-paste';
import { useFileDrop } from './use-file-drop';
import { BoardSeats } from '../voice/BoardSeats';
import { useMySeat } from '../voice/use-my-seat';
import { useCanvasColors } from '../theme';
import { inkOverFill } from './ink-over-fill';
import { useTranslation } from 'react-i18next';

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
  boardId: string;
  viewport: Viewport;
  spaceHeld: boolean;
  stageHandlers: StageHandlers;
  touchInput: boolean;
  onSizeChange: (size: { width: number; height: number }) => void;
  currentUserId: string;
}

export interface BoardCanvasHandle {
  // null — на дошці нема що знімати
  capture: () => { canvas: HTMLCanvasElement; frame: ExportFrame } | null;
}

// суто відображення — пан/зум живуть у useCanvasViewport, обʼєкти й
// виділення — у useObjectInteractions + board-store/editor-store; цей
// компонент лише міряє розмір, малює Stage і зводить усі обробники разом
export const BoardCanvas = forwardRef<BoardCanvasHandle, Props>(function BoardCanvas(
  { boardId, viewport, spaceHeld, stageHandlers, touchInput, onSizeChange, currentUserId },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const objectsLayerRef = useRef<Konva.Layer>(null);
  // на час знімка гасить виділення, чужі замки й бейджі — вони сидять у тому
  // ж шарі, що й обʼєкти, і інакше запеклися б у файл
  const [exporting, setExporting] = useState(false);
  // екранна точка з останнього mousemove — щоб переспівати курсор при пані/зумі
  const lastPointer = useRef<Point | null>(null);
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

  const { t } = useTranslation();
  const colors = useCanvasColors();
  const activeTool = useEditorStore((s) => s.activeTool);
  const canEdit = useEditorStore((s) => s.canEdit);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const objectsMap = useBoardStore((s) => s.objects);
  // перелічуємо лише коли змінились самі обʼєкти, не на кожен рендер (пан, зум)
  const inkOverFillIds = useMemo(() => inkOverFill(Object.values(objectsMap)), [objectsMap]);
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

  // глядачу тягати не можна ніколи, незалежно від інструмента; зайняте кимось
  // іншим — теж, поки він не вийде. Замкнений прапорцем — та сама заборона,
  // лише постійна й для всіх
  const draggableObjects = canEdit && activeTool === 'select';
  const lockedByOthers = useLockedByOthers();

  function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
    stageHandlers.onMouseDown(e);
    handleStageMouseDown(e);
  }

  // курсор іншим — у координатах дошки, а не екрана: у кожного свій зсув і
  // масштаб. Кадри складає presence-channel, він же їх і притримує.
  // Слухаємо window, а не mousemove на Stage: поки konva тягне вузол, Stage
  // подій миші не бачить узагалі, і чужий курсор застигав у точці захвату до
  // кінця жесту. Заразом переспівуємо останню точку на зміну viewport — під
  // час пану трекпадом миша стоїть, а точка дошки під нею вже інша
  useEffect(() => {
    // з тача курсор не шлемо взагалі: там його малює не браузер, а наш кадр
    // вікна нижче, і вістря спалахувало б лише в мить тапу
    if (touchInput) return;
    if (lastPointer.current) publishCursor(screenToBoard(lastPointer.current, viewport));
    function handleMouseMove(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      lastPointer.current = point;
      publishCursor(screenToBoard(point, viewport));
    }
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [touchInput, viewport]);

  // своя видима область: на тачі возимо її решті замість курсора, а заразом
  // по ній тримаємо чужі шильдики в полі зору
  const visibleRect = useMemo(
    () => getVisibleBoardRect(viewport, size.width, size.height),
    [viewport, size.width, size.height],
  );

  // ефект ловить і пан, і щипок, і поворот екрана — усе це міняє viewport або
  // size; частоту тримає presence-channel, сюди прилітає щокадру
  useEffect(() => {
    if (!touchInput || size.width === 0 || size.height === 0) return;
    publishViewport(visibleRect);
  }, [touchInput, visibleRect, size.width, size.height]);

  const saveSeat = useMySeat(boardId, currentUserId);
  const imageDrop = useImageDrop(boardId, currentUserId, containerRef, viewport);
  useLinkPaste(boardId, currentUserId, containerRef, viewport);
  useFileDrop(boardId, currentUserId, containerRef, viewport);

  // знімок усієї дошки, а не того, що видно. Камеру людини не чіпаємо взагалі:
  // шар малюється зі своїм поточним трансформом, тому рамку дошки переводимо
  // в екранні координати, а pixelRatio ділимо на масштаб — на виході ті самі
  // frame.pixelRatio пікселів на одиницю дошки. toCanvas не обрізає по розміру
  // Stage, тож обʼєкти за краєм екрана теж потрапляють.
  // flushSync комітить «exporting» синхронно, а браузер малює лише після
  // завершення таску — кадру без виділення людина не побачить. Через стор
  // виділення не знімаємо навмисно: його підписка шле виділення іншим
  useImperativeHandle(
    ref,
    () => ({
      capture() {
        const layer = objectsLayerRef.current;
        const stage = layer?.getStage();
        const targets = exportTargets(
          useBoardStore.getState().objects,
          useEditorStore.getState().selectedIds,
        );
        const bounds = contentBounds(targets.objects);
        if (!layer || !stage || !bounds) return null;
        const frame = exportFrame(bounds);
        // toCanvas малює ввесь шар і лише потім обрізає по рамці — невиділений
        // обʼєкт, що заходить у рамку виділеного, запікся б у файл. Тому решту
        // ховаємо, і прямо на вузлах konva: через react це був би перемонтаж,
        // і картинки після нього довантажувались би наново, з миганням
        const keep = new Set(targets.objects.map((o) => o.id));
        const hidden = targets.onlySelected
          ? Object.entries(nodesById.current)
              .filter(([id, node]) => !keep.has(id) && node.visible())
              .map(([, node]) => node)
          : [];
        flushSync(() => setExporting(true));
        try {
          for (const node of hidden) node.visible(false);
          const scale = stage.scaleX();
          const canvas = layer.toCanvas({
            x: frame.x * scale + stage.x(),
            y: frame.y * scale + stage.y(),
            width: frame.width * scale,
            height: frame.height * scale,
            pixelRatio: frame.pixelRatio / scale,
          });
          return { canvas, frame };
        } finally {
          // назад у тому ж таску — кадру з прихованими людина не побачить
          for (const node of hidden) node.visible(true);
          flushSync(() => setExporting(false));
        }
      },
    }),
    [],
  );

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
            <Grid
              viewport={viewport}
              width={size.width}
              height={size.height}
              rgb={colors.gridRgb}
              lineAlpha={colors.gridAlpha}
            />
          </Layer>

          {/* під інструментом створення шар «прозорий»: клік має дійти до Stage
          і поставити новий обʼєкт навіть поверх наявного (editor-store) */}
          <Layer ref={objectsLayerRef} listening={objectsListen(activeTool)}>
            {/* eslint-disable-next-line react-hooks/refs -- getRegisterRef читає
            registerRefCache.current лише для кешування функції за id, не для
            виводу в рендер; без кешу React бачив би нову ref-функцію щоразу */}
            {sortedObjects.map((object) => (
              <ObjectRenderer
                key={object.id}
                object={object}
                isSelected={!exporting && selectedIds.includes(object.id)}
                isEditing={!exporting && editingTextId === object.id}
                draggable={draggableObjects && isMovable(object, lockedByOthers)}
                viewportScale={viewport.scale}
                inkOverFill={inkOverFillIds.has(object.id)}
                exporting={exporting}
                boardId={boardId}
                registerRef={getRegisterRef(object.id)}
              />
            ))}

            {!exporting && <UploadPlaceholders />}
            {!exporting && (
              <>
                <RemoteSelections objects={objectsMap} viewportScale={viewport.scale} />
                <RemoteLocks objects={objectsMap} viewportScale={viewport.scale} />
                {/* замочок бачить і глядач: зняти його він не може, але знати,
                чому обʼєкт не рухається, має */}
                <LockedBadges objects={sortedObjects} viewportScale={viewport.scale} />

                {draft && <DraftPreview tool={draft.tool} start={draft.start} current={draft.current} />}
                {rubberBand && <RubberBandRect start={rubberBand.start} current={rubberBand.current} />}
              </>
            )}
          </Layer>

          {/* стільці — окремим шаром: свій тягається, тому шар ловить події */}
          <Layer>
            <BoardSeats viewportScale={viewport.scale} onDropMine={saveSeat} />
          </Layer>

          {/* чужа присутність — поверх обʼєктів, але під трансформером */}
          <Layer listening={false}>
            <RemoteViewports viewportScale={viewport.scale} visible={visibleRect} />
            <RemoteCursors viewportScale={viewport.scale} />
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
                lockedByOthers={lockedByOthers}
                touchInput={touchInput}
              />
            </Layer>
          )}
        </Stage>
      )}
      {imageDrop.uploading && <div className="board-island tool-error">{t('board.uploadingImage')}</div>}
      {imageDrop.error && <div className="board-island tool-error">{imageDrop.error}</div>}
      {editingObject && <TextEditOverlay object={editingObject} viewport={viewport} />}
    </div>
  );
});

function RubberBandRect({
  start,
  current,
}: {
  start: { x: number; y: number };
  current: { x: number; y: number };
}) {
  const colors = useCanvasColors();
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return (
    <Rect
      x={x}
      y={y}
      width={Math.abs(current.x - start.x)}
      height={Math.abs(current.y - start.y)}
      fill={colors.accentFill}
      stroke={colors.accent}
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
  tool: 'rect' | 'ellipse' | 'connector' | 'line';
  start: { x: number; y: number };
  current: { x: number; y: number };
}) {
  const colors = useCanvasColors();
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
        stroke={colors.accent}
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  if (tool === 'connector' || tool === 'line') {
    return (
      <Line
        points={[start.x, start.y, current.x, current.y]}
        stroke={colors.accent}
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
      />
    );
  }
  return (
    <Rect x={x} y={y} width={width} height={height} stroke={colors.accent} dash={[6, 4]} listening={false} />
  );
}
