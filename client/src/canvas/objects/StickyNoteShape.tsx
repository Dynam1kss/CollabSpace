import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { StickyObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../text-layout';
import { useMultiDragDelta } from './useMultiDrag';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';

interface Props {
  object: StickyObject;
  isSelected: boolean;
  isEditing: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function StickyNoteShape({ object, isSelected, isEditing, draggable, registerRef }: Props) {
  const updateObject = useBoardStore((s) => s.update);
  const startEditingText = useEditorStore((s) => s.startEditingText);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragMove, onDragEnd } = useMultiDragDelta(object.id);

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd(e);
    updateObject(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleEdit = () => startEditingText(object.id);

  return (
    <Group
      ref={registerRef}
      id={object.id}
      x={object.x}
      y={object.y}
      rotation={object.rotation}
      draggable={draggable}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={handleDragEnd}
      onDblClick={handleEdit}
      onDblTap={handleEdit}
    >
      <Rect
        name="box"
        width={object.width}
        height={object.height}
        fill={object.fillColor}
        cornerRadius={4}
        shadowColor="#000"
        shadowOpacity={0.15}
        shadowBlur={6}
        shadowOffsetY={2}
        stroke={isSelected ? '#4262ff' : undefined}
        strokeWidth={isSelected ? 1.5 : 0}
        strokeScaleEnabled={false}
      />
      {/* поки поверх стоїть textarea редагування — konva-текст ховаємо, інакше букви двояться */}
      <Text
        name="text"
        visible={!isEditing}
        text={object.text}
        x={10}
        y={10}
        width={object.width - 20}
        height={object.height - 20}
        fontSize={16}
        fontFamily={TEXT_FONT_FAMILY}
        lineHeight={TEXT_LINE_HEIGHT}
        fill={object.textColor}
        wrap="word"
        listening={false}
      />
    </Group>
  );
}
