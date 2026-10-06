import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage, Line, Path, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { linkKind, linkVertical, linkVideoId } from 'shared';
import type { LinkObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useEditorStore } from '../editor-store';
import { LINK_BASE_WIDTH, LINK_FONT, LINK_ICON, LINK_PAD, linkLayout } from '../link-layout';
import { openLink } from '../link-open';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { DEFAULT_INK, inkFor, useCanvasColors, useTheme } from '../../theme';
import { i18n } from '../../i18n';

// material «link», 24×24 — той самий контур, що в іконці панелі, але konva
// шляхом: у неї свого набору іконок немає
const LINK_GLYPH =
  'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z';

const RADIUS = 10;

// 16:9 беремо mqdefault — він рівно 320×180, без чорних смуг, різати нічого.
// shorts віддаються лише в hqdefault (480×360), і вертикальний кадр стоїть у
// ньому по центру між смугами — звідси обрізання нижче
function thumbUrl(videoId: string, vertical: boolean) {
  return `https://img.youtube.com/vi/${videoId}/${vertical ? 'hqdefault' : 'mqdefault'}.jpg`;
}

// вертикальний кадр усередині 480×360: висота вся, ширина — 360×9/16
const SHORTS_CROP = { x: (480 - (360 * 9) / 16) / 2, y: 0, width: (360 * 9) / 16, height: 360 };

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
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();

  const kind = linkKind(object);
  const videoId = linkVideoId(object);
  const layout = linkLayout(object);
  const ink = inkFor(DEFAULT_INK, theme);
  // вся картка — одна розкладка в базовій ширині, на дошці масштабована цілком
  const scale = object.width / LINK_BASE_WIDTH;

  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    updateSoon(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
  };

  // повну адресу показуємо нативною підказкою контейнера: у konva-тексту її
  // ніде не розмістити, а title на елементі нічого не виконує
  const showUrl = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = object.url;
  };
  const hideUrl = (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.title = '';
  };

  // відео дивимось у себе, решту відкриваємо у вкладці
  const handleActivate = () => {
    if (kind === 'youtube' && videoId) useEditorStore.getState().playVideo(videoId);
    else openLink(object.url);
  };

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
      onDblClick={handleActivate}
      onDblTap={handleActivate}
      onMouseEnter={showUrl}
      onMouseLeave={hideUrl}
    >
      <Group name="card" scaleX={scale} scaleY={scale}>
        <Rect
          name="box"
          width={LINK_BASE_WIDTH}
          height={layout.height}
          fill={colors.cardBg}
          cornerRadius={RADIUS}
          stroke={isSelected ? colors.accent : colors.cardBorder}
          strokeWidth={isSelected ? 1.5 : 1}
          strokeScaleEnabled={false}
        />
        <Group listening={false}>
          {layout.withIcon ? (
            <Path
              data={LINK_GLYPH}
              fill={colors.label}
              x={LINK_PAD}
              y={LINK_PAD}
              scaleX={LINK_ICON / 24}
              scaleY={LINK_ICON / 24}
            />
          ) : (
            <CardImage object={object} layout={layout} colors={colors} />
          )}
          <Text
            text={layout.title}
            x={layout.textX}
            y={layout.titleY}
            width={layout.textWidth}
            fontSize={layout.titleSize}
            fontStyle="bold"
            fontFamily={LINK_FONT}
            lineHeight={1.2}
            fill={ink}
            wrap="word"
          />
          {layout.description !== '' && (
            <Text
              text={layout.description}
              x={layout.textX}
              y={layout.descY}
              width={layout.textWidth}
              fontSize={layout.textSize}
              fontFamily={LINK_FONT}
              lineHeight={1.2}
              fill={colors.label}
              wrap="word"
            />
          )}
          <Text
            text={layout.domain}
            x={layout.textX}
            y={layout.domainY}
            width={layout.textWidth}
            fontSize={layout.textSize}
            fontFamily={LINK_FONT}
            lineHeight={1.2}
            fill={colors.label}
            wrap="word"
          />
        </Group>
      </Group>
    </Group>
  );
}

type Colors = ReturnType<typeof useCanvasColors>;

function CardImage({
  object,
  layout,
  colors,
}: {
  object: LinkObject;
  layout: ReturnType<typeof linkLayout>;
  colors: Colors;
}) {
  const kind = linkKind(object);
  const videoId = linkVideoId(object);
  const vertical = linkVertical(object);
  const src = kind === 'youtube' && videoId ? thumbUrl(videoId, vertical) : (object.previewImage ?? null);

  // стан завантаження тримаємо разом з адресою: інакше при її зміні довелось
  // би скидати прапорці в тілі ефекту, і картка на мить показувала б старе
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement | null } | null>(null);

  useEffect(() => {
    if (!src) return;
    const img = new window.Image();
    // мініатюра youtube віддається з Access-Control-Allow-Origin: *, тож
    // анонімний режим не ламає завантаження, зате полотно лишається «чистим»
    // і експорт у png/pdf не падає на tainted canvas
    img.crossOrigin = 'anonymous';
    img.onload = () => setLoaded({ src, image: img });
    img.onerror = () => setLoaded({ src, image: null });
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  const current = loaded?.src === src ? loaded : null;
  const image = current?.image ?? null;
  const failed = current !== null && current.image === null;
  const width = LINK_BASE_WIDTH;
  const height = layout.imageHeight;
  const crop = kind === 'youtube' && vertical ? SHORTS_CROP : undefined;
  const play = Math.min(56, height * 0.3);

  return (
    <Group>
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        <Rect width={width} height={height} fill={colors.placeholder} cornerRadius={[RADIUS, RADIUS, 0, 0]} />
        {image && <KonvaImage image={image} width={width} height={height} crop={crop} />}
        {failed && (
          <Path
            data={LINK_GLYPH}
            fill={colors.label}
            x={width / 2 - 16}
            y={height / 2 - 16}
            scaleX={32 / 24}
            scaleY={32 / 24}
          />
        )}
      </Group>
      {kind === 'youtube' && image !== null && (
        <>
          <Rect
            x={width / 2 - play * 0.9}
            y={height / 2 - play * 0.62}
            width={play * 1.8}
            height={play * 1.24}
            fill="rgba(0, 0, 0, 0.55)"
            cornerRadius={play * 0.28}
          />
          <Line
            points={[
              width / 2 - play * 0.22,
              height / 2 - play * 0.34,
              width / 2 + play * 0.4,
              height / 2,
              width / 2 - play * 0.22,
              height / 2 + play * 0.34,
            ]}
            closed
            fill="#ffffff"
          />
        </>
      )}
      {failed && kind !== 'youtube' && (
        <Text
          text={i18n.t('link.thumbFailed')}
          x={LINK_PAD}
          y={height / 2 + 22}
          width={width - LINK_PAD * 2}
          fontSize={11}
          fontFamily={LINK_FONT}
          fill={colors.label}
          align="center"
        />
      )}
    </Group>
  );
}
