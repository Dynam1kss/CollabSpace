import { Group, Path, Rect, Text } from 'react-konva';
import type { BoardObject } from 'shared';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { pivotOffset } from '../object-pivot';

interface Props {
  objects: Record<string, BoardObject>;
  viewportScale: number;
}

const BADGE_HEIGHT = 18;
const BADGE_PADDING = 6;
const LOCK_PATH = 'M2 5.5V4a2 2 0 0 1 4 0v1.5';

// обʼєкт, у якому хтось зараз друкує. Виділення того самого обʼєкта вже
// обведено рамкою в RemoteSelections — тут лишається сказати, що він саме
// зайнятий: замочок з імʼям над лівим верхнім кутом і ледь помітна заливка
// кольором того, хто друкує. Без цього подвійний клік просто нічого не робив
// би, і виглядало б це як поламане
export function RemoteLocks({ objects, viewportScale }: Props) {
  const locks = usePresenceStore((s) => s.locks);
  const members = usePresenceStore((s) => s.members);
  const selfClientId = usePresenceStore((s) => s.selfClientId);

  return (
    <>
      {Object.entries(locks).map(([key, objectId]) => {
        const clientId = Number(key);
        if (clientId === selfClientId) return null;
        const member = members[clientId];
        const object = objects[objectId];
        if (!member || !object) return null;
        const color = colorForUser(member.userId);
        const width = member.displayName.length * 6.5 + BADGE_PADDING * 3 + 10;
        const pivot = pivotOffset(object);

        return (
          <Group
            key={clientId}
            x={object.x + pivot.x}
            y={object.y + pivot.y}
            offsetX={pivot.x}
            offsetY={pivot.y}
            rotation={object.rotation}
            listening={false}
          >
            <Rect width={object.width} height={object.height} fill={color} opacity={0.12} />
            {/* шильдик сталого розміру на екрані — як і в курсора */}
            <Group
              y={-(BADGE_HEIGHT + 4) / viewportScale}
              scaleX={1 / viewportScale}
              scaleY={1 / viewportScale}
            >
              <Rect width={width} height={BADGE_HEIGHT} fill={color} cornerRadius={3} />
              <Path
                x={BADGE_PADDING}
                y={4}
                data={LOCK_PATH}
                stroke="#fff"
                strokeWidth={1.3}
                listening={false}
              />
              <Rect x={BADGE_PADDING + 0.5} y={9} width={7} height={5.5} fill="#fff" cornerRadius={1} />
              <Text
                x={BADGE_PADDING + 12}
                y={5}
                text={member.displayName}
                fontSize={10}
                fill="#fff"
                listening={false}
              />
            </Group>
          </Group>
        );
      })}
    </>
  );
}
