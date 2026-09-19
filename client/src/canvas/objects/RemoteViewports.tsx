import { Group, Rect, Text } from 'react-konva';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';

// все в екранних пікселях — ділимо на масштаб, щоб рамка лишалась однаково
// тонкою і на 10%, і на 400%; сам прямокутник при цьому в координатах дошки
const STROKE = 1.5;
const FRAME_RADIUS = 12;
const LABEL_HEIGHT = 18;
const LABEL_PADDING = 8;
const LABEL_INSET = 8;

interface Props {
  viewportScale: number;
  // що зараз видно мені самому — щоб не загубити шильдик за краєм екрана
  visible: { x: number; y: number; width: number; height: number };
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

  return (
    <>
      {Object.entries(viewports).map(([key, rect]) => {
        const clientId = Number(key);
        const member = members[clientId];
        // кадр був у дорозі, а людина вже вийшла — малювати нікого
        if (!member || clientId === selfClientId) return null;
        const color = colorForUser(member.userId);
        const labelWidth = member.displayName.length * 7 + LABEL_PADDING * 2;
        // вікно телефона вище за екран ноута, тому прибитий до кута напис
        // частіше за все просто не було б видно. Тягнемо його за краєм мого
        // власного вікна, але не випускаємо за межі самої рамки
        const labelBoxWidth = (labelWidth + LABEL_INSET * 2) * k;
        const labelBoxHeight = (LABEL_HEIGHT + LABEL_INSET * 2) * k;
        const labelX = Math.min(Math.max(rect.x, visible.x), rect.x + rect.width - labelBoxWidth);
        const labelY = Math.min(Math.max(rect.y, visible.y), rect.y + rect.height - labelBoxHeight);

        return (
          <Group key={clientId} listening={false}>
            <Rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              stroke={color}
              strokeWidth={STROKE * k}
              cornerRadius={FRAME_RADIUS * k}
              opacity={0.9}
            />
            <Group x={labelX} y={labelY} scaleX={k} scaleY={k}>
              <Rect
                x={LABEL_INSET}
                y={LABEL_INSET}
                width={labelWidth}
                height={LABEL_HEIGHT}
                fill={color}
                cornerRadius={LABEL_HEIGHT / 2}
              />
              <Text
                x={LABEL_INSET + LABEL_PADDING}
                y={LABEL_INSET + 5}
                text={member.displayName}
                fontSize={11}
                fill="#fff"
              />
            </Group>
          </Group>
        );
      })}
    </>
  );
}
