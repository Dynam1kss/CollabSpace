import { Group, Line, Rect, Text } from 'react-konva';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';

// вістря курсора: трикутник у координатах «від кінчика», далі вся група
// ділиться на масштаб — щоб на будь-якому зумі курсор лишався такого самого
// розміру на екрані, як і свій власний
const ARROW = [0, 0, 0, 14, 4, 10.5, 9.5, 12.5];
const LABEL_HEIGHT = 16;
const LABEL_PADDING = 5;

interface Props {
  viewportScale: number;
}

// чужі курсори. Малюються поверх усього і не ловлять події — це картинка,
// а не елемент керування
export function RemoteCursors({ viewportScale }: Props) {
  const members = usePresenceStore((s) => s.members);
  const cursors = usePresenceStore((s) => s.cursors);
  const selfClientId = usePresenceStore((s) => s.selfClientId);

  return (
    <>
      {Object.entries(cursors).map(([key, point]) => {
        const clientId = Number(key);
        const member = members[clientId];
        // курсор без запису в списку — людина вже вийшла, а кадр був у дорозі
        if (!member || clientId === selfClientId) return null;
        const color = colorForUser(member.userId);
        const width = member.displayName.length * 6.5 + LABEL_PADDING * 2;

        return (
          <Group key={clientId} x={point.x} y={point.y} scaleX={1 / viewportScale} scaleY={1 / viewportScale}>
            <Line points={ARROW} closed fill={color} stroke="#fff" strokeWidth={1} />
            <Rect x={10} y={14} width={width} height={LABEL_HEIGHT} fill={color} cornerRadius={3} />
            <Text
              x={10 + LABEL_PADDING}
              y={14 + 4}
              text={member.displayName}
              fontSize={10}
              fill="#fff"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
