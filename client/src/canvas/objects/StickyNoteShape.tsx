import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { StickyObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../text-layout';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';

interface Props {
  object: StickyObject;
  isSelected: boolean;
  isEditing: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function StickyNoteShape({ object, isSelected, isEditing, draggable, registerRef }: Props) {
  const updateSoon = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  const startEditingText = useEditorStore((s) => s.startEditingText);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  // позицію пишемо в стор на кожен рух, а не лише на dragend — інакше інші
  // бачать не рух, а стрибок на місце. так само наживо давно їде точка конектора
  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    updateSoon(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
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
      onDragMove={commitPosition}
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
