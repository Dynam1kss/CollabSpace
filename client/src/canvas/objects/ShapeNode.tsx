import { Ellipse, Rect } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ShapeObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useMultiDragDelta } from './useMultiDrag';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';

interface Props {
  object: ShapeObject;
  isSelected: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function ShapeNode({ object, isSelected, draggable, registerRef }: Props) {
  const updateObject = useBoardStore((s) => s.update);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragMove, onDragEnd } = useMultiDragDelta(object.id);

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd(e);
    // Konva.Ellipse позиціюється від центру, модель тримає x/y як top-left кута — перевести назад
    const offsetX = object.shapeKind === 'ellipse' ? object.width / 2 : 0;
    const offsetY = object.shapeKind === 'ellipse' ? object.height / 2 : 0;
    updateObject(object.id, { x: e.target.x() - offsetX, y: e.target.y() - offsetY });
  };

  const commonProps = {
    ref: registerRef,
    id: object.id,
    x: object.x,
    y: object.y,
    rotation: object.rotation,
    fill: object.fillColor,
    stroke: isSelected ? '#4262ff' : object.strokeColor,
    strokeWidth: object.strokeWidth,
    draggable,
    onMouseDown: handlePointerDown,
    onTouchStart: handlePointerDown,
    onDragStart,
    onDragMove,
    onDragEnd: handleDragEnd,
  };

  if (object.shapeKind === 'ellipse') {
    return (
      <Ellipse
        {...commonProps}
        // Konva.Ellipse позиціюється й розтягується від центру, а модель
        // тримає x/y/width/height як bounding box — переводимо тут
        x={object.x + object.width / 2}
        y={object.y + object.height / 2}
        radiusX={object.width / 2}
        radiusY={object.height / 2}
      />
    );
  }

  return <Rect {...commonProps} width={object.width} height={object.height} />;
}
