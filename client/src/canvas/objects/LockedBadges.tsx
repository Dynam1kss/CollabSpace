import { Group, Path, Rect } from 'react-konva';
import type { BoardObject } from 'shared';

const BADGE = 18;
// та сама дужка замка, що в шильдику чужого редагування
const LOCK_PATH = 'M2 5.5V4a2 2 0 0 1 4 0v1.5';

interface Props {
  objects: BoardObject[];
  viewportScale: number;
}

// замочок на замкненому обʼєкті — у правому верхньому куті, сталого розміру
// на екрані (як шильдик у RemoteLocks). Праворуч, а не ліворуч: ліворуч уже
// сідає імʼя того, хто зараз друкує в цьому ж обʼєкті
export function LockedBadges({ objects, viewportScale }: Props) {
  return (
    <>
      {objects
        .filter((o) => o.locked)
        .map((object) => (
          <Group
            key={object.id}
            x={object.x + object.width}
            y={object.y}
            rotation={object.rotation}
            listening={false}
          >
            <Group
              x={-BADGE / viewportScale}
              y={-(BADGE + 4) / viewportScale}
              scaleX={1 / viewportScale}
              scaleY={1 / viewportScale}
            >
              <Rect width={BADGE} height={BADGE} fill="#5a6072" cornerRadius={3} />
              <Path x={5} y={4} data={LOCK_PATH} stroke="#fff" strokeWidth={1.3} />
              <Rect x={5.5} y={9} width={7} height={5.5} fill="#fff" cornerRadius={1} />
            </Group>
          </Group>
        ))}
    </>
  );
}
