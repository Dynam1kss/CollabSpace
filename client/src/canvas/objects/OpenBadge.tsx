import { useState } from 'react';
import { Group, Path, Rect } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { LINK_BADGE, LINK_PAD, linkBadgeHit } from '../link-layout';
import type { CanvasColors } from '../../theme';

// розмір значка в координатах картки — спільний з розкладкою, бо вона лишає
// під нього місце в рядку підпису
const BADGE = LINK_BADGE;
// контури тієї самої іконки «відкрити», що й кнопка в контекстній панелі
const OPEN_GLYPH = ['M11 4h5v5', 'M16 4l-7 7', 'M14 12v4H4V6h4'];

// значок «відкрити» в правому верхньому куті картки. Видно ЗАВЖДИ, не лише
// на виділеній: інакше нізвідки здогадатись, що картку можна відкрити.
// Живе всередині картки, тому масштабується разом із нею
export function OpenBadge({
  overImage,
  colors,
  cardWidth,
  cardHeight,
  screenScale,
  onActivate,
}: {
  // значок лежить поверх картинки — тоді він білий із темним ореолом
  overImage: boolean;
  colors: CanvasColors;
  cardWidth: number;
  cardHeight: number;
  screenScale: number;
  onActivate: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const x = cardWidth - LINK_PAD - BADGE;
  const y = LINK_PAD;

  // поверх картинки — білим із темним ореолом: так читається і на світлому
  // кадрі, і на темному. На самій картці білим не можна (у світлій темі вона
  // біла), тому там звичайний приглушений колір
  const stroke = overImage ? '#ffffff' : colors.label;
  // прямокутник рахується в координатах КАРТКИ, а група значка зміщена —
  // тому переводимо його в її систему
  const hit = linkBadgeHit(cardWidth, cardHeight, screenScale);

  const cursor = (e: KonvaEventObject<MouseEvent>, value: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = value;
  };

  return (
    <Group
      x={x}
      y={y}
      opacity={hovered ? 1 : 0.75}
      onMouseEnter={(e) => {
        setHovered(true);
        cursor(e, 'pointer');
      }}
      onMouseLeave={(e) => {
        setHovered(false);
        cursor(e, '');
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onActivate();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onActivate();
      }}
    >
      {/* зона влучання — не менша за 44px на екрані; невидима, але ловить
      події. Натискання крізь неї доходить до групи картки, тож тягнути
      картку, почавши зі значка, можна як і раніше */}
      <Rect
        x={hit.x - x}
        y={hit.y - y}
        width={hit.size}
        height={hit.size}
        fill="transparent"
      />
      {OPEN_GLYPH.map((d) => (
        <Path
          key={d}
          data={d}
          stroke={stroke}
          strokeWidth={1.6}
          lineCap="round"
          lineJoin="round"
          listening={false}
          scaleX={BADGE / 20}
          scaleY={BADGE / 20}
          shadowColor="#000000"
          shadowBlur={3}
          shadowOpacity={overImage ? 0.85 : 0.35}
        />
      ))}
    </Group>
  );
}
