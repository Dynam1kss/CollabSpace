import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BoardObject } from 'shared';
import { useBoardStore } from './board-store';
import { screenToBoard } from './coordinates';
import type { Point, Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import type { ToolId } from './editor-store';
import { createAtPoint, createConnectorFromPoints, createShapeFromRect } from './object-defaults';
import type { CreatableTool } from './object-defaults';
import {
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  nextZIndex,
  pasteClipboard,
  selectAll,
} from './selection-actions';

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function isDrawTool(tool: ToolId): tool is 'rect' | 'ellipse' | 'connector' {
  return tool === 'rect' || tool === 'ellipse' || tool === 'connector';
}

function isCreatableTool(tool: ToolId): tool is CreatableTool {
  return tool !== 'select';
}

function objectBounds(obj: BoardObject) {
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

function rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

interface RubberBand {
  start: Point;
  current: Point;
}

interface Draft {
  tool: 'rect' | 'ellipse' | 'connector';
  start: Point;
  current: Point;
}

// стан і обробники для роботи з обʼєктами на рівні Stage: гумова рамка,
// створення протягуванням (фігури/конектор) чи кліком (стікер/текст),
// клавіші над виділенням (Delete, ctrl+a/c/x/v/d).
// Пан/зум/щипок і далі повністю в useCanvasViewport — цей хук лише додає
// свою логіку поверх (BoardCanvas викликає обидва набори обробників)
export function useObjectInteractions(
  viewport: Viewport,
  containerRef: RefObject<HTMLDivElement | null>,
  currentUserId: string,
) {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const select = useEditorStore((s) => s.select);
  const selectMany = useEditorStore((s) => s.selectMany);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const [rubberBand, setRubberBand] = useState<RubberBand | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const dragKindRef = useRef<'rubber-band' | 'draw' | null>(null);
  const rubberBandRef = useRef<RubberBand | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const finishRubberBand = useCallback(
    (band: RubberBand) => {
      const x1 = Math.min(band.start.x, band.current.x);
      const y1 = Math.min(band.start.y, band.current.y);
      const x2 = Math.max(band.start.x, band.current.x);
      const y2 = Math.max(band.start.y, band.current.y);
      // мікроскопічна рамка — це радше клік по порожньому, не виділення протягуванням
      if (x2 - x1 < 3 && y2 - y1 < 3) return;
      const rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      const hits = useBoardStore
        .getState()
        .getAll()
        .filter((obj) => rectsIntersect(objectBounds(obj), rect));
      selectMany(hits.map((o) => o.id));
    },
    [selectMany],
  );

  const finishDraw = useCallback(
    (d: Draft) => {
      const meta = { createdBy: currentUserId, zIndex: nextZIndex() };
      const object =
        d.tool === 'connector'
          ? createConnectorFromPoints(d.start, d.current, meta)
          : createShapeFromRect(
              d.tool,
              {
                x: Math.min(d.start.x, d.current.x),
                y: Math.min(d.start.y, d.current.y),
                width: Math.abs(d.current.x - d.start.x),
                height: Math.abs(d.current.y - d.start.y),
              },
              meta,
            );
      useBoardStore.getState().add(object);
      // порядок важливий: setActiveTool сама скидає selectedIds (щоб перемикання
      // на інший інструмент не лишало виділення від попереднього) — тому спершу
      // перемикаємось, а вже потім виділяємо щойно створений обʼєкт
      setActiveTool('select');
      select(object.id);
    },
    [currentUserId, select, setActiveTool],
  );

  // мишею: старт гумової рамки (інструмент "вибір") або протягування розміру
  // (фігура/конектор). Стікер/текст створюються на click нижче, не тут
  const handleStageMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage || e.target !== stage || e.evt.button !== 0) return;

      const screenPoint = stage.getPointerPosition();
      if (!screenPoint) return;
      const boardPoint = screenToBoard(screenPoint, viewportRef.current);

      if (activeTool === 'select') {
        if (!e.evt.shiftKey) clearSelection();
        dragKindRef.current = 'rubber-band';
        rubberBandRef.current = { start: boardPoint, current: boardPoint };
        setRubberBand(rubberBandRef.current);
        return;
      }

      if (isDrawTool(activeTool)) {
        dragKindRef.current = 'draw';
        draftRef.current = { tool: activeTool, start: boardPoint, current: boardPoint };
        setDraft(draftRef.current);
      }
    },
    [activeTool, clearSelection],
  );

  // клік (не протягування) інструментом стікера/тексту — одразу створює
  // обʼєкт стандартного розміру в точці кліку
  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (!stage || e.target !== stage) return;
      if (activeTool !== 'sticky' && activeTool !== 'text') return;

      const screenPoint = stage.getPointerPosition();
      if (!screenPoint) return;
      const boardPoint = screenToBoard(screenPoint, viewportRef.current);
      const object = createAtPoint(activeTool, boardPoint, {
        createdBy: currentUserId,
        zIndex: nextZIndex(),
      });
      useBoardStore.getState().add(object);
      setActiveTool('select');
      select(object.id);
    },
    [activeTool, currentUserId, select, setActiveTool],
  );

  // тап по порожньому місцю на дотику будь-яким інструментом малювання —
  // завжди стандартний розмір у точці тапу. Перетягування для розміру на
  // дотику свідомо не робимо: той самий жест (один палець по порожньому)
  // на дотику вже означає панорамування, займати його ще й малюванням
  // означало б лізти в useCanvasViewport, а це заборонено умовою задачі
  const handleStageTap = useCallback(
    (e: KonvaEventObject<TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage || e.target !== stage) return;
      if (!isCreatableTool(activeTool)) return;

      // браузер синтезує mousedown/click після touchend — без preventDefault він
      // долітає до handleStageMouseDown вже як клік по порожньому місцю (бо новий
      // вузол ще не встиг намалюватись) і одразу скидає щойно встановлене виділення
      e.evt.preventDefault();

      const screenPoint = stage.getPointerPosition();
      if (!screenPoint) return;
      const boardPoint = screenToBoard(screenPoint, viewportRef.current);
      const object = createAtPoint(activeTool, boardPoint, {
        createdBy: currentUserId,
        zIndex: nextZIndex(),
      });
      useBoardStore.getState().add(object);
      setActiveTool('select');
      select(object.id);
    },
    [activeTool, currentUserId, select, setActiveTool],
  );

  useEffect(() => {
    function toStagePoint(e: MouseEvent): Point | null {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function handleWindowMouseMove(e: MouseEvent) {
      if (!dragKindRef.current) return;
      const screenPoint = toStagePoint(e);
      if (!screenPoint) return;
      const boardPoint = screenToBoard(screenPoint, viewportRef.current);

      if (dragKindRef.current === 'rubber-band' && rubberBandRef.current) {
        rubberBandRef.current = { ...rubberBandRef.current, current: boardPoint };
        setRubberBand(rubberBandRef.current);
      } else if (dragKindRef.current === 'draw' && draftRef.current) {
        draftRef.current = { ...draftRef.current, current: boardPoint };
        setDraft(draftRef.current);
      }
    }

    function handleWindowMouseUp() {
      if (dragKindRef.current === 'rubber-band' && rubberBandRef.current) {
        finishRubberBand(rubberBandRef.current);
      } else if (dragKindRef.current === 'draw' && draftRef.current) {
        finishDraw(draftRef.current);
      }
      dragKindRef.current = null;
      rubberBandRef.current = null;
      draftRef.current = null;
      setRubberBand(null);
      setDraft(null);
    }

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [containerRef, finishRubberBand, finishDraw]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const { canEdit, selectedIds } = useEditorStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit || selectedIds.length === 0) return;
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      // по коду клавіші, а не по e.key — в українській розкладці ctrl+c дає 'с'.
      // глядачу — лише виділити все й скопіювати, решта міняє вміст
      const action = {
        KeyA: selectAll,
        KeyC: copySelected,
        KeyX: canEdit ? cutSelected : undefined,
        KeyV: canEdit ? () => pasteClipboard(currentUserId) : undefined,
        KeyD: canEdit ? () => duplicateSelected(currentUserId) : undefined,
      }[e.code];
      if (!action) return;
      // без цього браузер виділить текст сторінки / полізе в системний буфер
      e.preventDefault();
      action();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentUserId]);

  return {
    rubberBand,
    draft,
    handleStageMouseDown,
    handleStageClick,
    handleStageTap,
  };
}
