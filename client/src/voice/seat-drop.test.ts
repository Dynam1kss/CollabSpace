import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImageObject, ShapeObject } from 'shared';
import { boardDoc, cellDocs, resetBoardDoc, useBoardStore } from '../canvas/board-store';
import { setSyncStrategy } from '../canvas/sync-strategy';
import { nearestFreeSeat, SEAT_RADIUS } from './seat-position';

// «дозволити стільці» працювало через раз: скидання стільця на обʼєкт із
// забороною то відбивалось, то проходило. Сам шлях рішення виявився цілим —
// чергувалось значення прапорця в дзеркалі, бо в кімнаті зі змішаними
// стратегіями той самий обʼєкт мав двох письменників (журнал 05.10).
// Тут закріплено і правильну поведінку, і те, що чужий кадр головного
// документа в стратегії 3 на рішення більше не впливає

const sofa = (seatsAllowed: boolean): ShapeObject => ({
  id: 'sofa',
  type: 'shape',
  shapeKind: 'rect',
  x: -100,
  y: -100,
  width: 200,
  height: 200,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-05T00:00:00.000Z',
  fillColor: '#fff',
  strokeColor: '#000',
  strokeWidth: 2,
  seatsAllowed,
});

// те саме, що робить BoardSeats.handleDragEnd: бере обʼєкти зі стору й питає
// seat-position, куди насправді сідати. Свого стільця серед taken немає
const dropAt = (x: number, y: number) => nearestFreeSeat({ x, y }, [], useBoardStore.getState().getAll());

// прийняте скидання — те, після якого стілець лишився там, куди відпустили
const accepted = (x: number, y: number) => {
  const seat = dropAt(x, y);
  return seat.x === x && seat.y === y;
};

const inside = (p: { x: number; y: number }) => p.x > -100 && p.x < 100 && p.y > -100 && p.y < 100;

// велике тло: саме на таких обʼєктах стілець і лишався — вийти з них старий
// кільцевий пошук не діставав (журнал 06.10)
const backdrop = (): ImageObject => ({
  id: 'backdrop',
  type: 'image',
  x: -600,
  y: -450,
  width: 1200,
  height: 900,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  url: '/uploads/backdrop.png',
});

const distToBox = (p: { x: number; y: number }, r: ImageObject) => {
  const nx = Math.max(r.x, Math.min(p.x, r.x + r.width));
  const ny = Math.max(r.y, Math.min(p.y, r.y + r.height));
  return Math.hypot(p.x - nx, p.y - ny);
};

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('скидання стільця на обʼєкт і прапорець «дозволити стільці»', () => {
  for (const strategy of ['batched', 'aoi'] as const) {
    it(`${strategy}: заборонено — десять скидань підряд відбиваються однаково`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(sofa(false));

      for (let i = 0; i < 10; i++) {
        const seat = dropAt(0, 0);
        expect(accepted(0, 0), `скидання ${i + 1}`).toBe(false);
        // відкинуло за межі обʼєкта, а не просто кудись
        expect(inside(seat), `скидання ${i + 1}`).toBe(false);
      }
    });

    it(`${strategy}: дозволено — десять скидань підряд приймаються однаково`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(sofa(true));

      for (let i = 0; i < 10; i++) expect(accepted(0, 0), `скидання ${i + 1}`).toBe(true);
    });

    it(`${strategy}: рішення йде за прапорцем без відставання на крок`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(sofa(false));

      // перемикаємо, як це робить кнопка в панелі, і щоразу питаємо одразу
      for (const allowed of [true, true, false, false, true, false]) {
        useBoardStore.getState().update('sofa', { seatsAllowed: allowed });
        expect(accepted(0, 0), `прапорець ${allowed}`).toBe(allowed);
      }
    });
  }

  for (const strategy of ['batched', 'aoi'] as const) {
    it(`${strategy}: велике тло — стілець виходить із нього і з центру, і з краю`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(backdrop());
      const big = backdrop();

      // по всьому обʼєкту, не лише в центрі: раніше результат залежав саме від
      // того, наскільки глибоко скинули, — звідси й «через раз»
      for (const [x, y] of [
        [0, 0],
        [-550, -400],
        [550, 400],
        [0, -440],
        [-590, 0],
        [300, 200],
      ]) {
        const seat = dropAt(x, y);
        expect(distToBox(seat, big), `скидання в ${x},${y}`).toBeGreaterThanOrEqual(SEAT_RADIUS - 1e-6);
      }
    });

    it(`${strategy}: дозвіл на тому самому тлі — стілець лишається де відпустили`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add({ ...backdrop(), seatsAllowed: true });

      for (const [x, y] of [
        [0, 0],
        [-550, -400],
        [300, 200],
      ]) {
        expect(accepted(x, y), `скидання в ${x},${y}`).toBe(true);
      }
    });
  }

  // власна причина збою: у стратегії 3 вміст живе в клітинках, і чужий UPDATE
  // по головному документу раніше переписував дзеркало поверх них — прапорець
  // перемикався сам, і скидання чергувалось
  it('стратегія 3: чужий кадр головного документа рішення не змінює', () => {
    setSyncStrategy('aoi');
    resetBoardDoc();
    // обʼєкт зі снепшоту лягає в документ клітинки, прапорець знято
    cellDocs.open('0:0');
    cellDocs.seedFromSnapshot('0:0', [sofa(false)], true);
    expect(accepted(0, 0)).toBe(false);

    // сусід тримає той самий обʼєкт у головному документі з дозволом і шле його
    const sendFromPeer = () => {
      const peer = new Y.Doc();
      peer.getMap<ShapeObject>('objects').set('sofa', sofa(true));
      Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(peer), { source: 'network' });
    };

    for (let i = 0; i < 4; i++) {
      sendFromPeer();
      expect(accepted(0, 0), `кадр ${i + 1}`).toBe(false);
      expect(useBoardStore.getState().getById('sofa')?.seatsAllowed, `кадр ${i + 1}`).toBe(false);
    }
  });
});
