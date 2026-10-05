import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { stickyFontSize, textAlign } from 'shared';
import type { StickyObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../text-layout';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { useCanvasColors } from '../../theme';

interface Props {
  object: StickyObject;
  isSelected: boolean;
  isEditing: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function StickyNoteShape({ object, isSelected, isEditing, draggable, registerRef }: Props) {
  const colors = useCanvasColors();
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
        stroke={isSelected ? colors.accent : undefined}
        strokeWidth={isSelected ? 1.5 : 0}
        strokeScaleEnabled={false}
      />
      {/* поки поверх стоїть textarea редагування — konva-текст ховаємо, інакше букви двояться.
      обрізаємо по самій коробці: з великим шрифтом рядки інакше вилізли б за стікер,
      а переносу тут мало — висота коробки стала (06.10) */}
      <Group
        clipX={0}
        clipY={0}
        clipWidth={object.width}
        clipHeight={object.height}
        listening={false}
        visible={!isEditing}
      >
        <Text
          name="text"
          text={object.text}
          x={10}
          y={10}
          width={Math.max(0, object.width - 20)}
          height={Math.max(0, object.height - 20)}
          fontSize={stickyFontSize(object)}
          fontFamily={TEXT_FONT_FAMILY}
          lineHeight={TEXT_LINE_HEIGHT}
          fill={object.textColor}
          wrap="word"
          align={textAlign(object)}
          listening={false}
        />
      </Group>
    </Group>
  );
}
