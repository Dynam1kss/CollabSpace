import { Group, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { fileKind } from 'shared';
import type { FileObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { FILE_BASE_WIDTH, FILE_ICON, FILE_PAD, fileLayout } from '../file-layout';
import { LINK_FONT } from '../link-layout';
import { OpenBadge } from './OpenBadge';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { DEFAULT_INK, inkFor, useCanvasColors, useTheme } from '../../theme';

// значки типів — ті самі 24×24 контури, що й решта іконок, але konva-шляхом
const GLYPH: Record<string, string> = {
  image: 'M5 5h14v14H5z M8 13l2.5-3 3 3.5L16 11l3 4H5z',
  pdf: 'M7 3h7l5 5v13H7z M14 3v5h5',
  video: 'M4 6h12v12H4z M17 9l4-2v10l-4-2z',
  audio: 'M11 5v10a3 3 0 11-2-2.8V7l7-2v8a3 3 0 11-2-2.8V3z',
  text: 'M7 3h7l5 5v13H7z M14 3v5h5 M9 13h8 M9 16h8',
  archive: 'M4 7h16v13H4z M4 7l2-3h12l2 3 M11 7v4h2V7',
  other: 'M7 3h7l5 5v13H7z M14 3v5h5',
};

const RADIUS = 10;

interface Props {
  object: FileObject;
  boardId: string;
  isSelected: boolean;
  draggable: boolean;
  viewportScale: number;
  exporting: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function FileShape({
  object,
  boardId,
  isSelected,
  draggable,
  viewportScale,
  exporting,
  registerRef,
}: Props) {
  const colors = useCanvasColors();
  const theme = useTheme();
  const updateSoon = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  const layout = fileLayout(object);
  const ink = inkFor(DEFAULT_INK, theme);
  const scale = object.width / FILE_BASE_WIDTH;
  const glyph = GLYPH[fileKind(object.mime)] ?? GLYPH.other;

  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    updateSoon(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
  };

  // подвійний клік і значок у куті роблять одне: відкривають перегляд
  const open = () => useEditorStore.getState().openFilePreview(object.id);

  const showName = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = object.name;
  };
  const hideName = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = '';
  };

  void boardId;

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
      onDblClick={open}
      onDblTap={open}
      onMouseEnter={showName}
      onMouseLeave={hideName}
    >
      <Group name="card" scaleX={scale} scaleY={scale}>
        <Rect
          name="box"
          width={FILE_BASE_WIDTH}
          height={layout.height}
          fill={colors.cardBg}
          cornerRadius={RADIUS}
          stroke={isSelected ? colors.accent : colors.cardBorder}
          strokeWidth={isSelected ? 1.5 : 1}
          strokeScaleEnabled={false}
        />
        <Group listening={false}>
          <Path
            data={glyph}
            stroke={colors.label}
            strokeWidth={1.6}
            lineCap="round"
            lineJoin="round"
            x={FILE_PAD}
            y={FILE_PAD}
            scaleX={FILE_ICON / 24}
            scaleY={FILE_ICON / 24}
          />
          <Text
            text={layout.name}
            x={layout.textX}
            y={layout.nameY}
            width={layout.textWidth}
            height={layout.nameHeight}
            fontSize={layout.nameSize}
            fontStyle="bold"
            fontFamily={LINK_FONT}
            lineHeight={1.2}
            fill={ink}
            wrap="word"
            ellipsis
          />
          <Text
            text={layout.meta}
            x={layout.textX}
            y={layout.metaY}
            width={layout.textWidth}
            fontSize={layout.metaSize}
            fontFamily={LINK_FONT}
            lineHeight={1.2}
            fill={colors.label}
            wrap="none"
            ellipsis
          />
        </Group>
        {!exporting && (
          <OpenBadge
            overImage={false}
            colors={colors}
            cardWidth={FILE_BASE_WIDTH}
            cardHeight={layout.height}
            screenScale={scale * viewportScale}
            onActivate={open}
          />
        )}
      </Group>
    </Group>
  );
}
