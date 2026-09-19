import { useEffect, useState } from 'react';
import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { VIEWPORT_THROTTLE_MS } from '../presence-channel';
import { createPresenceTween } from './presence-tween';

// все в екранних пікселях — ділимо на масштаб, щоб рамка лишалась однаково
// тонкою і на 10%, і на 400%; сам прямокутник при цьому в координатах дошки
const STROKE = 1.5;
const FRAME_RADIUS = 12;
const LABEL_HEIGHT = 18;
const LABEL_PADDING = 8;
const LABEL_INSET = 8;

interface VisibleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  viewportScale: number;
  // що зараз видно мені самому — щоб не загубити шильдик за краєм екрана
  visible: VisibleRect;
}

// вікно тих, хто дивиться з телефона: тонка рамка навколо того шматка дошки,
// який у них зараз на екрані, і шильдик з імʼям, втиснутий у лівий верхній
// кут. Навмисно не схоже на курсор — курсор показує точку, а тут показувати
// точку нема чого: пальцем возять полотном, а не наводять
export function RemoteViewports({ viewportScale, visible }: Props) {
  const viewports = usePresenceStore((s) => s.viewports);
  const members = usePresenceStore((s) => s.members);
  const selfClientId = usePresenceStore((s) => s.selfClientId);

  const k = 1 / viewportScale;
  // доїзд читає моє видиме вікно на кожному кадрі. useState, а не useRef:
  // обʼєкт той самий на весь час життя компонента, і правила хуків не дають
  // читати ref із замикання, яке народжується в рендері
  const [mine] = useState<VisibleRect>(() => ({ x: 0, y: 0, width: 0, height: 0 }));

  // x, y, width, height — доїжджають усі чотири: під час щипка рамка міняє
  // розмір, і ступінчасте зростання помітне навіть більше за ступінчастий рух
  const [tween] = useState(() =>
    createPresenceTween(VIEWPORT_THROTTLE_MS, (node, [x, y, width, height]) => {
      const group = node as Konva.Group;
      group.position({ x, y });
      group.findOne<Konva.Rect>('.frame')?.size({ width, height });

      const label = group.findOne<Konva.Group>('.label');
      if (!label) return;
      // шильдик тягнемо за краєм мого власного вікна, але не випускаємо за
      // межі рамки — інакше в сусіда на екрані лишався б безіменний контур
      const scale = label.scaleX();
      const boxWidth = ((label.findOne<Konva.Rect>('.label-bg')?.width() ?? 0) + LABEL_INSET * 2) * scale;
      const boxHeight = (LABEL_HEIGHT + LABEL_INSET * 2) * scale;
      const labelX = Math.min(Math.max(x, mine.x), x + width - boxWidth);
      const labelY = Math.min(Math.max(y, mine.y), y + height - boxHeight);
      label.position({ x: labelX - x + LABEL_INSET * scale, y: labelY - y + LABEL_INSET * scale });
    }),
  );

  useEffect(() => {
    tween.retarget(
      Object.fromEntries(
        Object.entries(viewports).map(([key, r]) => [key, [r.x, r.y, r.width, r.height]]),
      ),
    );
  }, [tween, viewports]);

  // мій зсув чи масштаб змінився — рамка на дошці стоїть, а шильдик мав би
  // переїхати; без цього він лишався б на місці до наступного чужого кадру
  useEffect(() => {
    Object.assign(mine, visible);
    tween.refresh();
  }, [mine, tween, visible, viewportScale]);

  useEffect(() => () => tween.stop(), [tween]);

  return (
    <>
      {Object.entries(viewports).map(([key]) => {
        const clientId = Number(key);
        const member = members[clientId];
        // кадр був у дорозі, а людина вже вийшла — малювати нікого
        if (!member || clientId === selfClientId) return null;
        const color = colorForUser(member.userId);
        const labelWidth = member.displayName.length * 7 + LABEL_PADDING * 2;

        // ні позиції, ні розміру тут немає навмисно: їх виставляє доїзд, і
        // пропси затирали б його на кожному перемальовуванні
        return (
          <Group key={clientId} ref={tween.ref(clientId)} listening={false}>
            <Rect
              name="frame"
              stroke={color}
              strokeWidth={STROKE * k}
              cornerRadius={FRAME_RADIUS * k}
              opacity={0.9}
            />
            <Group name="label" scaleX={k} scaleY={k}>
              <Rect
                name="label-bg"
                width={labelWidth}
                height={LABEL_HEIGHT}
                fill={color}
                cornerRadius={LABEL_HEIGHT / 2}
              />
              <Text x={LABEL_PADDING} y={5} text={member.displayName} fontSize={11} fill="#fff" />
            </Group>
          </Group>
        );
      })}
    </>
  );
}
