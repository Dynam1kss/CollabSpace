import { describe, expect, it } from 'vitest';
import { defaultSeat, nearestFreeSeat, SEAT_MIN_GAP, SEAT_RADIUS } from './seat-position';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// відстань від точки до неповернутої рамки: 0 — точка всередині
const distToBox = (
  p: { x: number; y: number },
  r: { x: number; y: number; width: number; height: number },
) => {
  const nx = Math.max(r.x, Math.min(p.x, r.x + r.width));
  const ny = Math.max(r.y, Math.min(p.y, r.y + r.height));
  return Math.hypot(p.x - nx, p.y - ny);
};

describe('місце стільця', () => {
  it('вільну точку лишає як є', () => {
    const drop = { x: 100, y: 50 };
    expect(nearestFreeSeat(drop, [{ x: 400, y: 400 }])).toEqual(drop);
  });

  it('на зайнятій точці відсуває, але недалеко', () => {
    const taken = [{ x: 0, y: 0 }];
    const placed = nearestFreeSeat({ x: 0, y: 0 }, taken);

    expect(dist(placed, taken[0])).toBeGreaterThanOrEqual(SEAT_MIN_GAP);
    // не втекло на інший кінець дошки — зсув мінімальний, у межах пари кілець
    expect(dist(placed, { x: 0, y: 0 })).toBeLessThan(SEAT_MIN_GAP * 2);
  });

  it('розсуває від усіх сусідів одразу, а не лише від першого', () => {
    const taken = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 0, y: 30 },
      { x: 30, y: 30 },
    ];
    const placed = nearestFreeSeat({ x: 15, y: 15 }, taken);
    for (const seat of taken) expect(dist(placed, seat)).toBeGreaterThanOrEqual(SEAT_MIN_GAP);
  });

  it('не сідає на обʼєкт дошки', () => {
    const rect = { x: -50, y: -50, width: 100, height: 100 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [rect]);

    const insideX = placed.x > rect.x && placed.x < rect.x + rect.width;
    const insideY = placed.y > rect.y && placed.y < rect.y + rect.height;
    expect(insideX && insideY).toBe(false);
  });

  it('на обʼєкт із дозволом сідати можна', () => {
    const sofa = { x: -50, y: -50, width: 100, height: 100, seatsAllowed: true };
    // та сама точка, що й у попередньому тесті, але тепер обʼєкт не заважає
    expect(nearestFreeSeat({ x: 0, y: 0 }, [], [sofa])).toEqual({ x: 0, y: 0 });
  });

  it('дозвіл на одному обʼєкті не скасовує обходу решти', () => {
    const sofa = { x: -50, y: -50, width: 100, height: 100, seatsAllowed: true };
    const table = { x: -50, y: -50, width: 100, height: 100 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [sofa, table]);
    expect(placed).not.toEqual({ x: 0, y: 0 });
  });

  it('коли навколо все зайняте — лишаємо там, куди поклали', () => {
    // щільна сітка точок: вільного місця в межах пошуку немає
    const taken = [];
    for (let x = -400; x <= 400; x += 20) {
      for (let y = -400; y <= 400; y += 20) taken.push({ x, y });
    }
    expect(nearestFreeSeat({ x: 0, y: 0 }, taken)).toEqual({ x: 0, y: 0 });
  });

  it('перше місце стале для людини й різне для різних людей', () => {
    expect(defaultSeat('user-a')).toEqual(defaultSeat('user-a'));
    expect(defaultSeat('user-a')).not.toEqual(defaultSeat('user-b'));
    // на колі навколо початку координат
    const seat = defaultSeat('user-a');
    expect(Math.hypot(seat.x, seat.y)).toBeCloseTo(90, 5);
  });
});

// 06.10: з вимкненим дозволом стілець то відбивало, то лишало на обʼєкті.
// Кільцевий пошук був обмежений 8 кільцями по SEAT_MIN_GAP/2 — близько 176
// одиниць, тож із великого обʼєкта він просто не виходив і повертав саму точку
describe('великі обʼєкти, поворот і еліпси', () => {
  it('скидання в центр великого обʼєкта все одно виводить за його межі', () => {
    const big = { x: -300, y: -300, width: 600, height: 600 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [big]);
    expect(distToBox(placed, big)).toBeGreaterThanOrEqual(SEAT_RADIUS);
  });

  it('чим більший обʼєкт, тим далі виводить — і завжди виводить', () => {
    for (const half of [100, 300, 800, 2500]) {
      const big = { x: -half, y: -half, width: half * 2, height: half * 2 };
      const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [big]);
      expect(distToBox(placed, big), `півсторона ${half}`).toBeGreaterThanOrEqual(SEAT_RADIUS);
    }
  });

  it('двоє великих обʼєктів, що перекриваються: виводить за межі обох', () => {
    const a = { x: -400, y: -400, width: 800, height: 800 };
    const b = { x: -200, y: -200, width: 900, height: 900 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [a, b]);
    expect(distToBox(placed, a)).toBeGreaterThanOrEqual(SEAT_RADIUS);
    expect(distToBox(placed, b)).toBeGreaterThanOrEqual(SEAT_RADIUS);
  });
});

// поворот туди й назад через sin/cos коштує останніх бітів, тому в повернутих
// випадках звіряємось із запасом, а не з рівно SEAT_RADIUS
const outsideBy = (distance: number) => expect(distance).toBeGreaterThan(SEAT_RADIUS - 1e-6);

describe('справжні форми: поворот, еліпс, лінії', () => {
  // прямокутник 400×100 від (0,0), повернутий на 90° навколо свого лівого
  // верхнього кута (як крутить konva): на дошці він займає x ∈ [-100, 0],
  // y ∈ [0, 400], а не те, що написано в x/y/width/height
  const turned = { x: 0, y: 0, width: 400, height: 100, rotation: 90 };

  it('точка в неповернутій рамці, але поза самим обʼєктом — місце вільне', () => {
    expect(nearestFreeSeat({ x: 200, y: 50 }, [], [turned])).toEqual({ x: 200, y: 50 });
  });

  it('точка в повернутому обʼєкті — виводить за його межі', () => {
    const placed = nearestFreeSeat({ x: -50, y: 200 }, [], [turned]);
    // перевіряємо у власному просторі обʼєкта: там він знову звичайна рамка
    const local = { x: placed.y, y: -placed.x };
    outsideBy(distToBox(local, { x: 0, y: 0, width: 400, height: 100 }));
  });

  it('поворот на 45°: ромб, а не описана рамка', () => {
    const diamond = { x: 0, y: 0, width: 400, height: 400, rotation: 45 };
    // кут описаної рамки — поза ромбом, там сісти можна
    expect(nearestFreeSeat({ x: 300, y: 0 }, [], [diamond])).toEqual({ x: 300, y: 0 });
    // а всередині ромба — ні
    const r = Math.SQRT1_2;
    const placed = nearestFreeSeat({ x: 0, y: 300 }, [], [diamond]);
    const local = { x: placed.x * r + placed.y * r, y: -placed.x * r + placed.y * r };
    outsideBy(distToBox(local, { x: 0, y: 0, width: 400, height: 400 }));
  });

  // еліпс стоїть від центру, тому кути його рамки — порожнє місце
  const ellipse = {
    x: -200,
    y: -100,
    width: 400,
    height: 200,
    type: 'shape',
    shapeKind: 'ellipse',
  };

  it('у кутку рамки еліпса сісти можна — там самого еліпса немає', () => {
    expect(nearestFreeSeat({ x: 190, y: 95 }, [], [ellipse])).toEqual({ x: 190, y: 95 });
  });

  it('у центрі еліпса — виводить назовні по промені', () => {
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [ellipse]);
    const a = 200 + SEAT_RADIUS;
    const b = 100 + SEAT_RADIUS;
    expect(Math.hypot(placed.x / a, placed.y / b)).toBeGreaterThanOrEqual(1);
  });

  it('великий еліпс: виводить так само, хоч би як глибоко скинули', () => {
    const huge = { ...ellipse, x: -1500, y: -900, width: 3000, height: 1800 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [huge]);
    expect(
      Math.hypot(placed.x / (1500 + SEAT_RADIUS), placed.y / (900 + SEAT_RADIUS)),
    ).toBeGreaterThanOrEqual(1);
  });

  // конектор — штрих, його рамка це переважно порожнє місце
  it('лінія не блокує, навіть коли скидають просто на неї', () => {
    const line = { x: -300, y: -300, width: 600, height: 600, type: 'connector' };
    expect(nearestFreeSeat({ x: 0, y: 0 }, [], [line])).toEqual({ x: 0, y: 0 });
  });

  it('вузька фігура блокує: правило за типом обʼєкта, а не за товщиною', () => {
    const slab = { x: -300, y: -4, width: 600, height: 8 };
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [slab]);
    expect(distToBox(placed, slab)).toBeGreaterThanOrEqual(SEAT_RADIUS);
  });
});

// правило: блокує будь-який обʼєкт під точкою, у якого дозвіл знято. Дозвіл на
// одному обʼєкті не скасовує заборони на іншому під тією ж точкою — інакше
// «дозволити» на дрібному стікері відкривало б сідання на всьому, що під ним
describe('дозвіл і заборона на обʼєктах, що перекриваються', () => {
  const blocking = { x: -300, y: -300, width: 600, height: 600 };
  const allowed = { x: -500, y: -500, width: 1000, height: 1000, seatsAllowed: true };

  it('дозволений обʼєкт поверх забороненого не відкриває сідання', () => {
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [blocking, allowed]);
    expect(distToBox(placed, blocking)).toBeGreaterThanOrEqual(SEAT_RADIUS);
  });

  it('порядок у списку нічого не міняє', () => {
    const placed = nearestFreeSeat({ x: 0, y: 0 }, [], [allowed, blocking]);
    expect(distToBox(placed, blocking)).toBeGreaterThanOrEqual(SEAT_RADIUS);
  });

  it('поза забороненим, але в межах дозволеного — сідаємо як є', () => {
    expect(nearestFreeSeat({ x: 400, y: 400 }, [], [blocking, allowed])).toEqual({ x: 400, y: 400 });
  });
});
