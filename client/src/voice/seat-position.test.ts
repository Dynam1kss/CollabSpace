import { describe, expect, it } from 'vitest';
import { defaultSeat, nearestFreeSeat, SEAT_MIN_GAP } from './seat-position';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

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
