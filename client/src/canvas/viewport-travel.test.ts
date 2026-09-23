import { describe, expect, it } from 'vitest';
import { travelStep } from './viewport-travel';
import { MAX_SCALE, MIN_SCALE } from './coordinates';

const from = { x: 0, y: 0, scale: 1 };
const to = { x: 400, y: -200, scale: 4 };

describe('доїзд камери до чужого виду', () => {
  it('на старті — рівно те, звідки їдемо', () => {
    expect(travelStep(from, to, 0)).toEqual(from);
  });

  it('у кінці — рівно те, куди їдемо', () => {
    const end = travelStep(from, to, 1);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
    expect(end.scale).toBeCloseTo(to.scale, 6);
  });

  it('t поза межами не викидає камеру далі цілі', () => {
    expect(travelStep(from, to, -3)).toEqual(from);
    expect(travelStep(from, to, 5).x).toBeCloseTo(to.x, 6);
  });

  it('на середині шляху — рівно посередині по зсуву (easeInOutCubic симетричний)', () => {
    const mid = travelStep(from, to, 0.5);
    expect(mid.x).toBeCloseTo(200, 6);
    expect(mid.y).toBeCloseTo(-100, 6);
  });

  it('масштаб іде геометрично: посередині — корінь із добутку, не середнє', () => {
    const mid = travelStep({ ...from, scale: 1 }, { ...to, scale: 4 }, 0.5);
    expect(mid.scale).toBeCloseTo(2, 6); // √(1·4), а лінійно було б 2.5
  });

  it('рух монотонний — жодного відкату назад', () => {
    let prevX = -Infinity;
    let prevScale = 0;
    for (let i = 0; i <= 20; i++) {
      const v = travelStep(from, to, i / 20);
      expect(v.x).toBeGreaterThanOrEqual(prevX);
      expect(v.scale).toBeGreaterThanOrEqual(prevScale);
      prevX = v.x;
      prevScale = v.scale;
    }
  });

  it('масштаб дорогою лишається в дозволених межах', () => {
    for (let i = 0; i <= 20; i++) {
      const v = travelStep({ x: 0, y: 0, scale: MIN_SCALE }, { x: 10, y: 10, scale: MAX_SCALE }, i / 20);
      expect(v.scale).toBeGreaterThanOrEqual(MIN_SCALE);
      expect(v.scale).toBeLessThanOrEqual(MAX_SCALE);
    }
  });

  it('віддалення працює так само, як і наближення', () => {
    const mid = travelStep({ x: 0, y: 0, scale: 4 }, { x: 0, y: 0, scale: 1 }, 0.5);
    expect(mid.scale).toBeCloseTo(2, 6);
  });
});
