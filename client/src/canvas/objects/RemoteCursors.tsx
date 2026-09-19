import { useEffect, useState } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import { usePresenceStore } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { CURSOR_THROTTLE_MS } from '../presence-channel';
import { createPresenceTween } from './presence-tween';

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
  const viewports = usePresenceStore((s) => s.viewports);
  const selfClientId = usePresenceStore((s) => s.selfClientId);

  const [tween] = useState(() =>
    createPresenceTween(CURSOR_THROTTLE_MS, (node, [x, y]) => node.position({ x, y })),
  );

  useEffect(() => {
    tween.retarget(Object.fromEntries(Object.entries(cursors).map(([key, p]) => [key, [p.x, p.y]])));
  }, [tween, cursors]);

  useEffect(() => () => tween.stop(), [tween]);

  return (
    <>
      {Object.entries(cursors).map(([key]) => {
        const clientId = Number(key);
        const member = members[clientId];
        // курсор без запису в списку — людина вже вийшла, а кадр був у дорозі.
        // а хто вже прислав своє вікно, той на тачі — рамка замість вістря,
        // і обидва разом виглядали б як дві різні людини
        if (!member || clientId === selfClientId || clientId in viewports) return null;
        const color = colorForUser(member.userId);
        const width = member.displayName.length * 6.5 + LABEL_PADDING * 2;

        return (
          <Group
            key={clientId}
            ref={tween.ref(clientId)}
            scaleX={1 / viewportScale}
            scaleY={1 / viewportScale}
          >
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
