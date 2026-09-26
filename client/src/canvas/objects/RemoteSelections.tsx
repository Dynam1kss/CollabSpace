import { Arrow, Line, Rect } from 'react-konva';
import type { BoardObject, PresenceMember } from 'shared';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { pivotOffset } from '../object-pivot';
import { CONNECTOR_TENSION, flattenPoints } from './connector-geometry';

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
          // та сама геометрія, що й у самого конектора: без tension підсвітка
          // йшла прямими хордами повз намальовану криву. Ширша за лінію на ті
          // самі 3px екрана з кожного боку, що й відступ рамки в решти типів,
          // і напівпрозора — сама лінія має лишитись видною крізь ореол
          const halo = {
            points: flattenPoints(object.points),
            tension: CONNECTOR_TENSION,
            stroke: color,
            strokeWidth: object.strokeWidth + padding * 2,
            opacity: 0.45,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
            listening: false,
          };
          return object.arrowEnd ? (
            <Arrow key={id} {...halo} pointerLength={10} pointerWidth={10} fill={color} />
          ) : (
            <Line key={id} {...halo} />
          );
        }

        // крутимо навколо того ж центру, що й сам обʼєкт: з x - padding рамка
        // на куті відʼїжджала, а в еліпса — на сотню пікселів
        const pivot = pivotOffset(object);
        return (
          <Rect
            key={id}
            x={object.x + pivot.x}
            y={object.y + pivot.y}
            offsetX={pivot.x + padding}
            offsetY={pivot.y + padding}
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
