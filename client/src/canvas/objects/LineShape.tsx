import { useState } from 'react';
import { Arrow, Circle, Group, Line } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { BoardPoint, LineObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { dashPattern } from './line-geometry';
import { withEnds } from './point-box';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { CANVAS_COLORS, inkFor, useTheme } from '../../theme';

const HANDLE_SCREEN_RADIUS = 7;
// ціль під палець: кружечок лишається дрібним, росте лише невидима зона
const TOUCH_TARGET = 44;
// тонку лінію мишею не влучити — розширюємо зону кліку, не малюючи її
const HIT_STROKE = 16;

interface Props {
  object: LineObject;
  isSelected: boolean;
  draggable: boolean;
  viewportScale: number;
  inkOverFill: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

// пряма між двома точками. Влаштована так само, як конектор: кінці — в
// абсолютних координатах дошки, група стоїть у (0,0), під час тягання зсув
// накопичує x/y групи, а на dragend він запікається в кінці й скидається
// назад у нуль — інакше наступне тягання здвоїть зсув. Групову трансформацію
// так само запікає SelectionOverlay, тому лінія має name 'line'
export function LineShape({ object, isSelected, draggable, viewportScale, inkOverFill, registerRef }: Props) {
  const theme = useTheme();
  const accent = CANVAS_COLORS[theme].accent;
  const updateSoon = useBoardStore((s) => s.updateSoon);
  // кінці на момент захвату: поки жест іде, малюємо їх, а зсув несе група —
  // інакше зсув ліг би двічі (та сама пастка, що в конектора)
  const [dragBase, setDragBase] = useState<{ from: BoardPoint; to: BoardPoint } | null>(null);
  const showHandles = useEditorStore((s) => s.canEdit && isSelected && s.selectedIds.length === 1);
  const touchInput = useEditorStore((s) => s.touchInput);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  // під час жесту стор уже міг поїхати, а object у замиканні — з рендеру
  function freshEnds() {
    const fresh = useBoardStore.getState().getById(object.id);
    return fresh?.type === 'line' ? { from: fresh.from, to: fresh.to } : { from: object.from, to: object.to };
  }

  const handleDragStart = () => {
    onDragStart();
    setDragBase(freshEnds());
  };

  // x/y групи konva рахує від початку жесту, тому це завжди повний зсув
  const commitDrag = (e: KonvaEventObject<DragEvent>) => {
    if (!dragBase) return;
    const dx = e.target.x();
    const dy = e.target.y();
    if (dx === 0 && dy === 0) return;
    updateSoon(
      object.id,
      withEnds(
        { x: dragBase.from.x + dx, y: dragBase.from.y + dy },
        { x: dragBase.to.x + dx, y: dragBase.to.y + dy },
      ),
    );
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitDrag(e);
    // спершу стор, потім повернення групи в нуль — інакше кадр між цим малює
    // лінію на старому місці
    useBoardStore.getState().flushUpdates();
    e.target.position({ x: 0, y: 0 });
    setDragBase(null);
  };

  function dragEnd(which: 'from' | 'to') {
    return (e: KonvaEventObject<DragEvent>) => {
      // подія кружечка не має дійти до групи — та прочитала б її як власний зсув
      e.cancelBubble = true;
      const ends = freshEnds();
      const moved = { x: e.target.x(), y: e.target.y() };
      updateSoon(object.id, withEnds(which === 'from' ? moved : ends.from, which === 'to' ? moved : ends.to));
      if (e.type === 'dragend') useBoardStore.getState().flushUpdates();
    };
  }

  const stopBubble = (
    e: KonvaEventObject<MouseEvent> | KonvaEventObject<TouchEvent> | KonvaEventObject<DragEvent>,
  ) => {
    e.cancelBubble = true;
  };

  const strokeColor = isSelected ? accent : inkFor(object.strokeColor, theme, inkOverFill);
  const ends = dragBase ?? { from: object.from, to: object.to };
  const hasArrow = !!object.arrowStart || !!object.arrowEnd;

  const lineProps = {
    name: 'line',
    points: [ends.from.x, ends.from.y, ends.to.x, ends.to.y],
    stroke: strokeColor,
    strokeWidth: object.strokeWidth,
    dash: dashPattern(object),
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    hitStrokeWidth: HIT_STROKE,
  };

  const handleStrokeWidth = 1.5 / viewportScale;
  const touchHit = touchInput ? (TOUCH_TARGET - HANDLE_SCREEN_RADIUS * 2) / viewportScale : undefined;

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
      {hasArrow ? (
        <Arrow
          {...lineProps}
          pointerAtBeginning={!!object.arrowStart}
          pointerAtEnding={!!object.arrowEnd}
          pointerLength={10}
          pointerWidth={10}
          fill={strokeColor}
        />
      ) : (
        <Line {...lineProps} />
      )}
      {showHandles &&
        (['from', 'to'] as const).map((which) => (
          <Circle
            key={which}
            x={ends[which].x}
            y={ends[which].y}
            radius={HANDLE_SCREEN_RADIUS / viewportScale}
            hitStrokeWidth={touchHit}
            fill="#fff"
            stroke={accent}
            strokeWidth={handleStrokeWidth}
            draggable={draggable}
            onMouseDown={stopBubble}
            onTouchStart={stopBubble}
            onDragStart={stopBubble}
            onDragMove={dragEnd(which)}
            onDragEnd={dragEnd(which)}
          />
        ))}
    </Group>
  );
}
