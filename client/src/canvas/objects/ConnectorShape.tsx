import { useEffect, useRef, useState } from 'react';
import { Arrow, Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BoardPoint, ConnectorObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { CONNECTOR_TENSION, flattenPoints, midpoints, withPoints } from './connector-geometry';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';

const HANDLE_SCREEN_RADIUS = 7; // px на екрані, не в координатах дошки — тому ділимо на масштаб нижче
const MID_HANDLE_SCREEN_RADIUS = 5;
// ціль під палець; кружечок лишається дрібним, росте лише невидима зона
// довкола — hitStrokeWidth іде половиною назовні, тому до діаметра додається
// рівно різниця
const TOUCH_TARGET = 44;

interface Props {
  object: ConnectorObject;
  isSelected: boolean;
  draggable: boolean;
  viewportScale: number;
  registerRef: (node: Konva.Node | null) => void;
}

// лінія і кружечки її точок — одна група, яка й тягається як ціле: points —
// абсолютні координати дошки, група стоїть у (0,0), під час тягання x/y групи
// накопичують зсув, а на dragend він запікається у points і скидається назад
// у 0 — інакше наступне тягання здвоїть зсув (і в points, і в group.x/y одразу).
// Групову трансформацію (кілька виділених) так само запікає в points
// SelectionOverlay — тому лінія має name, щоб він її знайшов
export function ConnectorShape({ object, isSelected, draggable, viewportScale, registerRef }: Props) {
  const updateObject = useBoardStore((s) => s.update);
  const updateSoon = useBoardStore((s) => s.updateSoon);
  // точки на момент захвату. Поки жест іде, малюємо саме їх, а зсув несе x/y
  // групи — так само, як було завжди. Якби малювали те, що щокадру лягає в
  // стор, зсув застосувався б двічі: і в точках, і в групі (та сама пастка,
  // що з трансформером 17.09)
  const [dragBase, setDragBase] = useState<BoardPoint[] | null>(null);
  // ручки точок — лише коли конектор виділений сам; у групі він у трансформері.
  // глядачу ручок не даємо — ними міняють точки
  const showHandles = useEditorStore((s) => s.canEdit && isSelected && s.selectedIds.length === 1);
  const touchInput = useEditorStore((s) => s.touchInput);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();
  // зняти window-слухачі тягання щойно вставленої точки — і при pointerup,
  // і якщо компонент розмонтували посеред жесту
  const stopInsertDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopInsertDragRef.current?.(), []);

  const handleDragStart = () => {
    onDragStart();
    setDragBase(freshPoints());
  };

  // x/y групи konva рахує від початку жесту, а не від попереднього кадру,
  // тому це завжди повний зсув — можна класти абсолютні точки, скільки б
  // разів за кадр сюди не зайшли
  const commitDrag = (e: KonvaEventObject<DragEvent>) => {
    if (!dragBase) return;
    const dx = e.target.x();
    const dy = e.target.y();
    if (dx === 0 && dy === 0) return;
    updateSoon(object.id, withPoints(dragBase.map((p) => ({ x: p.x + dx, y: p.y + dy }))));
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitDrag(e);
    // спершу дописуємо стор, і лише потім повертаємо групу в нуль і
    // розморожуємо точки — інакше кадр між цим малює конектор на старому місці
    useBoardStore.getState().flushUpdates();
    e.target.position({ x: 0, y: 0 });
    setDragBase(null);
  };

  // під час тягання стор оновлюється на кожен рух, а object у замиканні —
  // з моменту рендеру, тому точки беремо свіжі зі стору
  function freshPoints() {
    const fresh = useBoardStore.getState().getById(object.id);
    return fresh?.type === 'connector' ? fresh.points : [];
  }

  function movePoint(index: number, point: BoardPoint) {
    updateObject(object.id, withPoints(freshPoints().map((p, i) => (i === index ? point : p))));
  }

  function dragMainPoint(index: number) {
    return (e: KonvaEventObject<DragEvent>) => {
      // drag-події кружечка не мають долітати до групи — та прочитала б
      // x/y кружечка як власний зсув
      e.cancelBubble = true;
      movePoint(index, { x: e.target.x(), y: e.target.y() });
    };
  }

  // другорядна точка в мить натискання стає основною (вставляється в points)
  // і далі їде за курсором через window pointermove, а не konva draggable:
  // після вставки React перемонтовує кружечки, а konva-drag розмонтування
  // вузла не переживає — жест обірвався б одразу
  function startInsertDrag(midIndex: number) {
    return (e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent>) => {
      e.cancelBubble = true;
      e.evt.preventDefault();
      const stage = e.target.getStage();
      if (!stage) return;
      const points = freshPoints();
      const mid = midpoints(points)[midIndex];
      updateObject(
        object.id,
        withPoints([...points.slice(0, midIndex + 1), mid, ...points.slice(midIndex + 1)]),
      );

      const index = midIndex + 1;
      const onMove = (ev: PointerEvent) => {
        const rect = stage.container().getBoundingClientRect();
        movePoint(index, {
          x: (ev.clientX - rect.left - stage.x()) / stage.scaleX(),
          y: (ev.clientY - rect.top - stage.y()) / stage.scaleY(),
        });
      };
      const onUp = () => {
        stopInsertDragRef.current = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      stopInsertDragRef.current = onUp;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
  }

  const stopBubble = (
    e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent> | KonvaEventObject<DragEvent>,
  ) => {
    e.cancelBubble = true;
  };

  const strokeColor = isSelected ? '#4262ff' : object.strokeColor;
  const points = dragBase ?? object.points;

  const lineProps = {
    name: 'line',
    points: flattenPoints(points),
    tension: CONNECTOR_TENSION,
    stroke: strokeColor,
    strokeWidth: object.strokeWidth,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    hitStrokeWidth: 16, // тонку лінію важко влучити мишею чи пальцем — розширюємо зону кліку
  };

  const handleStrokeWidth = 1.5 / viewportScale;
  const touchHit = (radius: number) => (touchInput ? (TOUCH_TARGET - radius * 2) / viewportScale : undefined);

  return (
    <Group
      ref={registerRef}
      id={object.id}
      draggable={draggable}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onDragStart={handleDragStart}
      onDragMove={commitDrag}
      onDragEnd={handleDragEnd}
    >
      {object.arrowEnd ? (
        <Arrow {...lineProps} pointerLength={10} pointerWidth={10} fill={strokeColor} />
      ) : (
        <Line {...lineProps} />
      )}
      {showHandles &&
        midpoints(points).map((p, i) => (
          <Circle
            key={`mid-${i}`}
            x={p.x}
            y={p.y}
            radius={MID_HANDLE_SCREEN_RADIUS / viewportScale}
            hitStrokeWidth={touchHit(MID_HANDLE_SCREEN_RADIUS)}
            fill="#4262ff"
            stroke="#fff"
            strokeWidth={handleStrokeWidth}
            onMouseDown={startInsertDrag(i)}
            onTouchStart={startInsertDrag(i)}
          />
        ))}
      {showHandles &&
        points.map((p, i) => (
          <Circle
            key={`main-${i}`}
            x={p.x}
            y={p.y}
            radius={HANDLE_SCREEN_RADIUS / viewportScale}
            hitStrokeWidth={touchHit(HANDLE_SCREEN_RADIUS)}
            fill="#fff"
            stroke="#4262ff"
            strokeWidth={handleStrokeWidth}
            draggable={draggable}
            onMouseDown={stopBubble}
            onTouchStart={stopBubble}
            onDragStart={stopBubble}
            onDragMove={dragMainPoint(i)}
            onDragEnd={dragMainPoint(i)}
          />
        ))}
    </Group>
  );
}
