import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { TextObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from '../text-layout';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { CANVAS_COLORS, inkFor, useTheme } from '../../theme';

interface Props {
  object: TextObject;
  isSelected: boolean;
  isEditing: boolean;
  draggable: boolean;
  inkOverFill: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

// група з прозорим Rect під текстом: Rect дає рамку виділення й зону кліку
// розміром з увесь блок (сам Text без width/height міряється лише по гліфах),
// а Text малюється з авто-висотою — konva з фіксованою height обрізає рядки,
// що не влізли, а нам текст не можна обрізати ніколи
export function TextShape({ object, isSelected, isEditing, draggable, inkOverFill, registerRef }: Props) {
  const theme = useTheme();
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
        fill="transparent"
        stroke={isSelected ? CANVAS_COLORS[theme].accent : undefined}
        strokeWidth={isSelected ? 1 : 0}
        strokeScaleEnabled={false}
      />
      <Text
        name="text"
        visible={!isEditing}
        text={object.text}
        width={object.autoWidth ? undefined : object.width}
        wrap={object.autoWidth ? 'none' : 'word'}
        fontSize={object.fontSize}
        fontFamily={TEXT_FONT_FAMILY}
        lineHeight={TEXT_LINE_HEIGHT}
        fill={inkFor(object.color, theme, inkOverFill)}
        listening={false}
      />
    </Group>
  );
}
