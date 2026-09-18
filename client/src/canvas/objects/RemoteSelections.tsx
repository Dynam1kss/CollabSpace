import { Line, Rect } from 'react-konva';
import type { BoardObject, PresenceMember } from 'shared';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { flattenPoints } from './connector-geometry';

interface Props {
  objects: Record<string, BoardObject>;
  viewportScale: number;
}

// що виділив хтось інший — тонка рамка його кольором. Своє виділення й далі
// показує синє обведення самої фігури плюс трансформер, тож переплутати важко
export function RemoteSelections({ objects, viewportScale }: Props) {
  const selections = usePresenceStore((s) => s.selections);
  const members = usePresenceStore((s) => s.members);
  const selfClientId = usePresenceStore((s) => s.selfClientId);

  // один обʼєкт — одна рамка: якщо його виділили двоє, малюємо першого,
  // бо другу рамку однаково нема куди покласти
  const owners = new Map<string, PresenceMember>();
  for (const [key, ids] of Object.entries(selections)) {
    const clientId = Number(key);
    if (clientId === selfClientId) continue;
    const member = members[clientId];
    if (!member) continue;
    for (const id of ids) if (!owners.has(id)) owners.set(id, member);
  }

  const strokeWidth = 1.5 / viewportScale;
  const padding = 3 / viewportScale;

  return (
    <>
      {[...owners].map(([id, member]) => {
        const object = objects[id];
        if (!object) return null;
        const color = colorForUser(member.userId);

        if (object.type === 'connector') {
          return (
            <Line
              key={id}
              points={flattenPoints(object.points)}
              stroke={color}
              strokeWidth={object.strokeWidth + strokeWidth * 2}
              opacity={0.45}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          );
        }

        return (
          <Rect
            key={id}
            x={object.x - padding}
            y={object.y - padding}
            width={object.width + padding * 2}
            height={object.height + padding * 2}
            rotation={object.rotation}
            stroke={color}
            strokeWidth={strokeWidth}
            listening={false}
          />
        );
      })}
    </>
  );
}
