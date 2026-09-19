import { useEffect, useState } from 'react';
import { Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { usePresenceStore } from '../presence-store';
import type { CursorPoint } from '../presence-store';
import { colorForUser } from '../presence-colors';
import { CURSOR_THROTTLE_MS } from '../presence-channel';

// вістря курсора: трикутник у координатах «від кінчика», далі вся група
// ділиться на масштаб — щоб на будь-якому зумі курсор лишався такого самого
// розміру на екрані, як і свій власний
const ARROW = [0, 0, 0, 14, 4, 10.5, 9.5, 12.5];
const LABEL_HEIGHT = 16;
const LABEL_PADDING = 5;

// кадри курсора приходять раз на CURSOR_THROTTLE_MS. Якщо класти їх у вузол
// як є, рух виходить рваний — ~18 стрибків на секунду. Тому між двома
// останніми отриманими точками доїжджаємо самі, за rAF, рівно за той самий
// інтервал. React у цьому не бере участі: позиція не пропс, а виставляється
// руками по вузлу konva — інакше довелось би перемальовувати компонент 60
// разів на секунду. Свого курсора це не стосується, його малює браузер
interface Tween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  start: number;
}

interface Anim {
  nodes: Map<number, Konva.Group>;
  // ref-функції кешуються за clientId: нова функція на кожен рендер змушувала б
  // React відчіпляти й чіпляти вузол на кожному кадрі курсора
  refs: Map<number, (node: Konva.Group | null) => void>;
  tweens: Map<number, Tween>;
  // кому вже поставили першу точку — до неї їхати нізвідки
  placed: Set<number>;
  raf: number | null;
}

function step(anim: Anim) {
  const now = performance.now();
  let layer: Konva.Layer | null = null;
  for (const [clientId, t] of anim.tweens) {
    const node = anim.nodes.get(clientId);
    if (!node) {
      anim.tweens.delete(clientId);
      continue;
    }
    const k = Math.min(1, (now - t.start) / CURSOR_THROTTLE_MS);
    node.position({ x: t.fromX + (t.toX - t.fromX) * k, y: t.fromY + (t.toY - t.fromY) * k });
    layer ??= node.getLayer();
    if (k >= 1) anim.tweens.delete(clientId);
  }
  layer?.batchDraw();
  anim.raf = anim.tweens.size > 0 ? requestAnimationFrame(() => step(anim)) : null;
}

function retarget(anim: Anim, cursors: Record<number, CursorPoint>) {
  for (const clientId of anim.refs.keys()) {
    if (clientId in cursors) continue;
    anim.refs.delete(clientId);
    anim.tweens.delete(clientId);
    anim.placed.delete(clientId);
  }
  for (const [key, point] of Object.entries(cursors)) {
    const clientId = Number(key);
    const node = anim.nodes.get(clientId);
    if (!node) continue;
    if (!anim.placed.has(clientId)) {
      anim.placed.add(clientId);
      node.position(point);
      node.getLayer()?.batchDraw();
      continue;
    }
    anim.tweens.set(clientId, {
      fromX: node.x(),
      fromY: node.y(),
      toX: point.x,
      toY: point.y,
      start: performance.now(),
    });
  }
  if (anim.tweens.size > 0 && anim.raf === null) anim.raf = requestAnimationFrame(() => step(anim));
}

function refFor(anim: Anim, clientId: number) {
  let fn = anim.refs.get(clientId);
  if (!fn) {
    fn = (node) => {
      if (node) anim.nodes.set(clientId, node);
      else anim.nodes.delete(clientId);
    };
    anim.refs.set(clientId, fn);
  }
  return fn;
}

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

  // useState, а не useRef: обʼєкт той самий на весь час життя компонента, але
  // читати його можна й у рендері (ref у рендері — заборонено правилами хуків)
  const [anim] = useState<Anim>(() => ({
    nodes: new Map(),
    refs: new Map(),
    tweens: new Map(),
    placed: new Set(),
    raf: null,
  }));

  useEffect(() => {
    retarget(anim, cursors);
  }, [anim, cursors]);

  useEffect(
    () => () => {
      if (anim.raf !== null) cancelAnimationFrame(anim.raf);
    },
    [anim],
  );

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
            ref={refFor(anim, clientId)}
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
