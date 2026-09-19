import { useEffect, useState } from 'react';
import { Circle, Group, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { usePresenceStore } from '../canvas/presence-store';
import { publishSeat, SEAT_THROTTLE_MS } from '../canvas/presence-channel';
import { createPresenceTween } from '../canvas/objects/presence-tween';
import { useSeatStore } from './seat-store';
import { useVoiceStore } from './voice-store';

// розмір в екранних пікселях: стілець не має розпухати разом із зумом —
// він позначка людини, а не обʼєкт дошки
const RADIUS = 18;
const RING = 2.5;

interface Props {
  viewportScale: number;
  // живе перетягування робимо тут, а запис у базу — на тому, хто нас малює:
  // йому й так належить boardId
  onDropMine: () => void;
}

// «стільці» — по одному на людину, яка зараз на дошці. Від курсора
// відрізняються і сенсом, і виглядом: курсор миготить туди-сюди й показує,
// куди дивляться зараз, а стілець ставлять один раз і надовго. Малюємо лише
// присутніх: місце в базі лежить і в того, кого зараз нема, але показувати
// порожній стілець означало б удавати, що людина тут
export function BoardSeats({ viewportScale, onDropMine }: Props) {
  const members = usePresenceStore((s) => s.members);
  const selfClientId = usePresenceStore((s) => s.selfClientId);
  const mine = useSeatStore((s) => s.mine);
  const others = useSeatStore((s) => s.others);
  const voicePeers = useVoiceStore((s) => s.peers);
  const inVoice = useVoiceStore((s) => s.inVoice);

  const k = 1 / viewportScale;

  // чужі стільці доїжджають між кадрами, як курсори й рамка вікна: кадри
  // йдуть 8 разів на секунду, а тягнуть стілець плавно
  const [tween] = useState(() =>
    createPresenceTween(SEAT_THROTTLE_MS, (node, [x, y]) => node.position({ x, y })),
  );

  useEffect(() => {
    tween.retarget(Object.fromEntries(Object.entries(others).map(([key, s]) => [key, [s.x, s.y]])));
  }, [tween, others]);

  useEffect(() => () => tween.stop(), [tween]);

  function handleDragMove(e: KonvaEventObject<DragEvent>) {
    const seat = { x: e.target.x(), y: e.target.y() };
    useSeatStore.getState().setMine(seat);
    publishSeat(seat);
  }

  return (
    <>
      {Object.entries(others).map(([key]) => {
        const clientId = Number(key);
        const member = members[clientId];
        if (!member || clientId === selfClientId) return null;
        return (
          <Group key={clientId} ref={tween.ref(clientId)} listening={false}>
            <SeatBody
              color={colorForUser(member.userId)}
              initials={initialsOf(member.displayName)}
              name={member.displayName}
              inVoice={!!voicePeers[clientId]}
              k={k}
            />
          </Group>
        );
      })}

      {mine && selfClientId !== null && members[selfClientId] && (
        <Group
          x={mine.x}
          y={mine.y}
          draggable
          onDragMove={handleDragMove}
          onDragEnd={onDropMine}
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = 'grab';
          }}
          onMouseLeave={(e) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = '';
          }}
        >
          <SeatBody
            color={colorForUser(members[selfClientId].userId)}
            initials={initialsOf(members[selfClientId].displayName)}
            name={`${members[selfClientId].displayName} (я)`}
            inVoice={inVoice}
            k={k}
          />
        </Group>
      )}
    </>
  );
}

interface BodyProps {
  color: string;
  initials: string;
  name: string;
  inVoice: boolean;
  k: number;
}

// поки людина не в розмові, стілець блідий: місце за нею лишається, але на
// гучність воно ще ні на що не впливає (крок C)
function SeatBody({ color, initials, name, inVoice, k }: BodyProps) {
  const r = RADIUS * k;
  return (
    <>
      <Circle
        radius={r}
        fill={color}
        opacity={inVoice ? 1 : 0.4}
        stroke="#fff"
        strokeWidth={RING * k}
      />
      <Text
        x={-r}
        y={-5 * k}
        width={r * 2}
        text={initials}
        align="center"
        fontSize={12 * k}
        fontStyle="bold"
        fill="#fff"
        opacity={inVoice ? 1 : 0.6}
        listening={false}
      />
      <Text
        x={-40 * k}
        y={r + 3 * k}
        width={80 * k}
        text={name}
        align="center"
        fontSize={10 * k}
        fill="#4b5563"
        listening={false}
      />
    </>
  );
}
