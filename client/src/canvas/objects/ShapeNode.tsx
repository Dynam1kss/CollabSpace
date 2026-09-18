import { Ellipse, Rect } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ShapeObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useDragGesture } from './useMultiDrag';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';

interface Props {
  object: ShapeObject;
  isSelected: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function ShapeNode({ object, isSelected, draggable, registerRef }: Props) {
  const updateSoon = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  // позицію пишемо в стор на кожен рух, а не лише на dragend — інакше інші
  // бачать не рух, а стрибок на місце. так само наживо давно їде точка конектора
  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    // Konva.Ellipse позиціюється від центру, модель тримає x/y як top-left кута — перевести назад
    const offsetX = object.shapeKind === 'ellipse' ? object.width / 2 : 0;
    const offsetY = object.shapeKind === 'ellipse' ? object.height / 2 : 0;
    updateSoon(object.id, { x: e.target.x() - offsetX, y: e.target.y() - offsetY });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
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
    onDragMove: commitPosition,
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
