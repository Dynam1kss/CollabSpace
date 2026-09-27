import { useEffect, useState } from 'react';
import { Circle, Group, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { usePresenceStore } from '../canvas/presence-store';
import { publishSeat, SEAT_THROTTLE_MS } from '../canvas/presence-channel';
import { createPresenceTween } from '../canvas/objects/presence-tween';
import { useBoardStore } from '../canvas/board-store';
import { useEditorStore } from '../canvas/editor-store';
import { nearestFreeSeat } from './seat-position';
import { useSeatStore } from './seat-store';
import { useVoiceStore } from './voice-store';
import { useCanvasColors } from '../theme';

// розмір в екранних пікселях: стілець не має розпухати разом із зумом —
// він позначка людини, а не обʼєкт дошки
const RADIUS = 18;
const RING = 2.5;
// свій стілець тягають пальцем — зона захвату добирається до 44px невидимо
const TOUCH_TARGET = 44;
// наскільки кільце «говорить» виступає за кружечок
const SPEAK_RING = 4;

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
  const speaking = useVoiceStore((s) => s.speaking);
  const selfSpeaking = useVoiceStore((s) => s.selfSpeaking);
  const touchInput = useEditorStore((s) => s.touchInput);

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

  // відпустили — сідаємо на найближче вільне місце. Інакше двоє стільців
  // лягають один в один, і ні ініціалів, ні імен уже не прочитати
  function handleDragEnd(e: KonvaEventObject<DragEvent>) {
    const taken = Object.entries(useSeatStore.getState().others)
      .filter(([key]) => Number(key) !== selfClientId)
      .map(([, seat]) => seat);
    const blocks = useBoardStore.getState().getAll();
    const seat = nearestFreeSeat({ x: e.target.x(), y: e.target.y() }, taken, blocks);
    e.target.position(seat);
    useSeatStore.getState().setMine(seat);
    publishSeat(seat);
    onDropMine();
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
              speaking={!!speaking[clientId]}
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
          onDragEnd={handleDragEnd}
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
            speaking={selfSpeaking}
            k={k}
            touch={touchInput}
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
  speaking: boolean;
  k: number;
  touch?: boolean;
}

// поки людина не в розмові, стілець блідий: місце за нею лишається, але на
// гучність воно ще ні на що не впливає (крок C)
function SeatBody({ color, initials, name, inVoice, speaking, k, touch }: BodyProps) {
  const labelColor = useCanvasColors().label;
  const r = RADIUS * k;
  return (
    <>
      {/* кільце «говорить» — те саме зелене, що й у панелі голосу, щоб це
      читалось як один сигнал у двох місцях. Малюємо ПІД кружечком і ширшим
      за нього, тому воно лишається видним і коли стілець блідий */}
      {speaking && <Circle radius={r + SPEAK_RING * k} fill="#22c55e" opacity={0.9} listening={false} />}
      <Circle
        radius={r}
        fill={color}
        opacity={inVoice ? 1 : 0.4}
        stroke="#fff"
        strokeWidth={RING * k}
        hitStrokeWidth={touch ? (TOUCH_TARGET - RADIUS * 2) * k : undefined}
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
        fill={labelColor}
        listening={false}
      />
    </>
  );
}
