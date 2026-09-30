import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Image as KonvaImage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { colorForUser, initialsOf } from '../canvas/presence-colors';
import { cardFromPresence, usePresenceStore } from '../canvas/presence-store';
import { openProfileCard } from '../components/profile-card-store';
import { publishSeat, SEAT_THROTTLE_MS } from '../canvas/presence-channel';
import { createPresenceTween } from '../canvas/objects/presence-tween';
import { useBoardStore } from '../canvas/board-store';
import { useEditorStore } from '../canvas/editor-store';
import { nearestFreeSeat } from './seat-position';
import { useSeatStore } from './seat-store';
import { useVoiceStore } from './voice-store';
import { frameAt, loadGifFrames } from './gif-frames';
import { watchGif } from './gif-ticker';
import { useCanvasColors } from '../theme';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
          // чужий стілець слухає клік — з нього відкривається картка профілю.
          // картка в dom, а не на полотні, тому позицію беремо з події миші
          <Group
            key={clientId}
            ref={tween.ref(clientId)}
            onClick={(e) => openProfileCard({ ...cardFromPresence(member), at: pointerOf(e) })}
            onTap={(e) => openProfileCard({ ...cardFromPresence(member), at: pointerOf(e) })}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = 'pointer';
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = '';
            }}
          >
            <SeatBody
              color={colorForUser(member.userId)}
              initials={initialsOf(member.displayName)}
              name={member.displayName}
              avatarUrl={member.avatarUrl}
              inVoice={!!voicePeers[clientId]}
              speaking={!!speaking[clientId]}
              k={k}
              touch={touchInput}
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
            name={t('voice.me', { name: members[selfClientId].displayName })}
            avatarUrl={members[selfClientId].avatarUrl}
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

// точка кліку в координатах вікна. Беремо не з evt, а вказівник самої сцени:
// konva вже звела туди і мишу, і палець, і додаємо лише зсув полотна на сторінці
function pointerOf(e: KonvaEventObject<Event>) {
  const stage = e.target.getStage();
  const point = stage?.getPointerPosition();
  if (!stage || !point) return { x: 0, y: 0 };
  const box = stage.container().getBoundingClientRect();
  return { x: box.left + point.x, y: box.top + point.y };
}

// той самий прийом, що в ImageShape: звичайний Image, поки вантажиться — нічого.
// gif konva сама не гортає — див. gif-ticker
function useAvatarImage(url: string | null | undefined) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => {
      img.onload = null;
      setImage(null);
    };
  }, [url]);
  return url ? image : null;
}

interface BodyProps {
  color: string;
  initials: string;
  name: string;
  avatarUrl?: string | null;
  inVoice: boolean;
  speaking: boolean;
  k: number;
  touch?: boolean;
}

// поки людина не в розмові, стілець блідий: місце за нею лишається, але на
// гучність воно ще ні на що не впливає (крок C)
function SeatBody({ color, initials, name, avatarUrl, inVoice, speaking, k, touch }: BodyProps) {
  const labelColor = useCanvasColors().label;
  const photo = useAvatarImage(avatarUrl);
  const photoRef = useRef<Konva.Image>(null);
  const isGif = !!avatarUrl && /\.gif$/i.test(avatarUrl);
  // кадри з декодера вже квадратні — обрізати їх, як img, не треба
  const [animated, setAnimated] = useState(false);
  // gif: поки кадри не декодовані (чи браузер не вміє ImageDecoder) — перший
  // кадр із самого img; далі таймер підставляє потрібний за часом
  useEffect(() => {
    if (!photo || !isGif || !avatarUrl) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void loadGifFrames(avatarUrl).then((gif) => {
      const node = photoRef.current;
      const layer = node?.getLayer();
      if (cancelled || !gif || !node || !layer) return;
      setAnimated(true);
      stop = watchGif(layer, (now) => {
        const frame = frameAt(gif, now);
        if (node.image() === frame) return false;
        node.image(frame);
        return true;
      });
    });
    return () => {
      cancelled = true;
      stop?.();
      setAnimated(false);
    };
  }, [photo, isGif, avatarUrl]);
  // не квадратне фото (gif не кадрується) — центральний квадрат, як object-fit: cover.
  // нулі — без обрізання (так konva і розуміє)
  const side = photo && !animated ? Math.min(photo.naturalWidth, photo.naturalHeight) : 0;
  const cropX = photo && side ? (photo.naturalWidth - side) / 2 : 0;
  const cropY = photo && side ? (photo.naturalHeight - side) / 2 : 0;
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
      {/* фото — поверх кольорового кружечка, обрізане кругом; біле кільце
      малюємо ще раз зверху, інакше його перекриває картинка */}
      {photo && (
        <>
          <Group
            listening={false}
            opacity={inVoice ? 1 : 0.4}
            clipFunc={(ctx) => {
              ctx.arc(0, 0, r, 0, Math.PI * 2);
            }}
          >
            <KonvaImage
              ref={photoRef}
              image={photo}
              cropX={cropX}
              cropY={cropY}
              cropWidth={side}
              cropHeight={side}
              x={-r}
              y={-r}
              width={r * 2}
              height={r * 2}
            />
          </Group>
          <Circle radius={r} stroke="#fff" strokeWidth={RING * k} listening={false} />
        </>
      )}
      <Text
        visible={!photo}
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
