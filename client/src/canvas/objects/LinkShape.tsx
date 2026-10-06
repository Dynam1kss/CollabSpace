import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Line, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { linkDomain, linkKind, linkVideoId } from 'shared';
import type { LinkObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { TEXT_FONT_FAMILY } from '../text-layout';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { DEFAULT_INK, inkFor, useCanvasColors } from '../../theme';
import { useTheme } from '../../theme';
import { i18n } from '../../i18n';

// material «link», 24×24 — той самий контур, що в іконці панелі, але konva
// шляхом: у неї свого набору іконок немає
const LINK_GLYPH =
  'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z';

const PAD = 12;
const RADIUS = 10;
// підпис під мініатюрою відео: та сама висота, що й у всієї «обгортки» картки
export const LINK_CHROME_HEIGHT = 48;

function thumbUrl(videoId: string) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

interface Props {
  object: LinkObject;
  isSelected: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function LinkShape({ object, isSelected, draggable, registerRef }: Props) {
  const colors = useCanvasColors();
  const theme = useTheme();
  const updateSoon = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  const startEditingLink = useEditorStore((s) => s.startEditingLink);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  const kind = linkKind(object);
  const videoId = linkVideoId(object);
  const domain = linkDomain(object.url);
  const ink = inkFor(DEFAULT_INK, theme);

  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    updateSoon(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
  };

  // повну адресу показуємо нативною підказкою контейнера: у konvaтексту
  // її ніде не розмістити, а title на елементі — не innerHTML і нічого не
  // виконує, хай би що було в адресі
  const showUrl = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = object.url;
  };
  const hideUrl = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = '';
  };

  const handleEdit = () => startEditingLink(object.id);

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
      onMouseEnter={showUrl}
      onMouseLeave={hideUrl}
    >
      <Rect
        name="box"
        width={object.width}
        height={object.height}
        fill={colors.cardBg}
        cornerRadius={RADIUS}
        stroke={isSelected ? colors.accent : colors.cardBorder}
        strokeWidth={isSelected ? 1.5 : 1}
        strokeScaleEnabled={false}
      />
      {kind === 'youtube' && videoId ? (
        <YoutubeBody object={object} videoId={videoId} domain={domain} ink={ink} colors={colors} />
      ) : (
        <WebBody object={object} domain={domain} ink={ink} colors={colors} />
      )}
    </Group>
  );
}

type Colors = ReturnType<typeof useCanvasColors>;

function WebBody({
  object,
  domain,
  ink,
  colors,
}: {
  object: LinkObject;
  domain: string;
  ink: string;
  colors: Colors;
}) {
  const glyph = 22;
  const textX = PAD + glyph + 10;
  const textWidth = Math.max(0, object.width - textX - PAD);
  return (
    <Group listening={false}>
      <Path
        data={LINK_GLYPH}
        fill={colors.label}
        x={PAD}
        y={PAD}
        // шлях намальований у 24×24 — зводимо до потрібного розміру
        scaleX={glyph / 24}
        scaleY={glyph / 24}
      />
      <Text
        text={object.title?.trim() || domain}
        x={textX}
        y={PAD}
        width={textWidth}
        fontSize={15}
        fontStyle="bold"
        fontFamily={TEXT_FONT_FAMILY}
        fill={ink}
        wrap="none"
        ellipsis
      />
      <Text
        text={domain}
        x={textX}
        y={PAD + 22}
        width={textWidth}
        fontSize={12}
        fontFamily={TEXT_FONT_FAMILY}
        fill={colors.label}
        wrap="none"
        ellipsis
      />
    </Group>
  );
}

function YoutubeBody({
  object,
  videoId,
  domain,
  ink,
  colors,
}: {
  object: LinkObject;
  videoId: string;
  domain: string;
  ink: string;
  colors: Colors;
}) {
  // стан завантаження тримаємо разом з id відео, а не окремими прапорцями:
  // інакше при зміні адреси треба було б скидати їх у тілі ефекту, і картка
  // на мить показувала б мініатюру попереднього відео
  const [loaded, setLoaded] = useState<{ id: string; image: HTMLImageElement | null } | null>(null);

  useEffect(() => {
    const img = new window.Image();
    // мініатюра віддається з Access-Control-Allow-Origin: *, тож анонімний
    // режим не ламає завантаження — зате полотно лишається «чистим» і
    // експорт у png/pdf не падає на tainted canvas
    img.crossOrigin = 'anonymous';
    img.onload = () => setLoaded({ id: videoId, image: img });
    img.onerror = () => setLoaded({ id: videoId, image: null });
    img.src = thumbUrl(videoId);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [videoId]);

  const current = loaded?.id === videoId ? loaded : null;
  const image = current?.image ?? null;
  const failed = current !== null && current.image === null;

  const thumbHeight = Math.max(0, object.height - LINK_CHROME_HEIGHT);
  const thumbWidth = object.width;
  const label = object.title?.trim() || 'YouTube';
  // hqdefault — 480×360, і всередині нього 16:9 кадр із чорними смугами по
  // 45px зверху й знизу. Тому квадрат беремо не з усього файлу, а з самого
  // кадру: 270×270 по центру — інакше третина картки була б чорною
  const crop = { x: 105, y: 45, width: 270, height: 270 };
  const play = Math.min(56, thumbHeight * 0.3);

  return (
    <Group listening={false}>
      <Group clipX={0} clipY={0} clipWidth={thumbWidth} clipHeight={thumbHeight}>
        <Rect width={thumbWidth} height={thumbHeight} fill={colors.placeholder} cornerRadius={[RADIUS, RADIUS, 0, 0]} />
        {image && (
          <KonvaImage image={image} width={thumbWidth} height={thumbHeight} crop={crop} />
        )}
        {failed && (
          <Path
            data={LINK_GLYPH}
            fill={colors.label}
            x={thumbWidth / 2 - 16}
            y={thumbHeight / 2 - 16}
            scaleX={32 / 24}
            scaleY={32 / 24}
          />
        )}
      </Group>
      {image && (
        <>
          <Rect
            x={thumbWidth / 2 - play * 0.9}
            y={thumbHeight / 2 - play * 0.62}
            width={play * 1.8}
            height={play * 1.24}
            fill="rgba(0, 0, 0, 0.55)"
            cornerRadius={play * 0.28}
          />
          <Line
            points={[
              thumbWidth / 2 - play * 0.22,
              thumbHeight / 2 - play * 0.34,
              thumbWidth / 2 + play * 0.4,
              thumbHeight / 2,
              thumbWidth / 2 - play * 0.22,
              thumbHeight / 2 + play * 0.34,
            ]}
            closed
            fill="#ffffff"
          />
        </>
      )}
      <Text
        text={label}
        x={PAD}
        y={thumbHeight + 8}
        width={Math.max(0, object.width - PAD * 2)}
        fontSize={14}
        fontStyle="bold"
        fontFamily={TEXT_FONT_FAMILY}
        fill={ink}
        wrap="none"
        ellipsis
      />
      <Text
        text={failed ? i18n.t('link.thumbFailed') : domain}
        x={PAD}
        y={thumbHeight + 26}
        width={Math.max(0, object.width - PAD * 2)}
        fontSize={11}
        fontFamily={TEXT_FONT_FAMILY}
        fill={colors.label}
        wrap="none"
        ellipsis
      />
    </Group>
  );
}
