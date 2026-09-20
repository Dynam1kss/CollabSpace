import { describe, expect, it } from 'vitest';
import type { Rect } from './transform-math';
import {
  MIN_SIZE,
  gripFor,
  handlePoint,
  mapIntoBox,
  resizeFromPointer,
  scaledStrokeWidth,
} from './transform-math';

// прямокутник 200x100 з лівим верхнім кутом у (100, 50)
const rect: Rect = { x: 100, y: 50, width: 200, height: 100 };
const grip = (handle: string) => gripFor(rect, 0, handle);
const at = (handle: string, x: number, y: number, lock = false) =>
  resizeFromPointer(grip(handle), { x, y }, lock);

describe('нерухома точка для кожної ручки', () => {
  // правило одне: тягнемо ліву сторону — нерухома права, верхню — нижня
  const cases: [string, number, number][] = [
    ['bottom-right', 100, 50], // напроти — лівий верхній
    ['top-left', 300, 150], // правий нижній
    ['top-right', 100, 150], // лівий нижній
    ['bottom-left', 300, 50], // правий верхній
    ['middle-right', 100, 50], // лівий край
    ['middle-left', 300, 50], // правий край
    ['bottom-center', 100, 50], // верхній край
    ['top-center', 100, 150], // нижній край
  ];

  it.each(cases)('%s спирається на (%i, %i)', (handle, x, y) => {
    const g = grip(handle);
    expect(g.x).toBe(x);
    expect(g.y).toBe(y);
  });

  it('ребро тягне лише свою вісь', () => {
    expect(grip('middle-right')).toMatchObject({ drivesX: true, drivesY: false });
    expect(grip('top-center')).toMatchObject({ drivesX: false, drivesY: true });
    expect(grip('bottom-right')).toMatchObject({ drivesX: true, drivesY: true });
  });

  it('точка самої ручки — та, за яку взялись', () => {
    expect(handlePoint(rect, 'bottom-right')).toEqual({ x: 300, y: 150 });
    expect(handlePoint(rect, 'top-left')).toEqual({ x: 100, y: 50 });
    expect(handlePoint(rect, 'middle-right')).toEqual({ x: 300, y: 100 });
    expect(handlePoint(rect, 'top-center')).toEqual({ x: 200, y: 50 });
  });
});

describe('звичайний resize', () => {
  it('правий нижній кут іде за курсором', () => {
    expect(at('bottom-right', 400, 200)).toMatchObject({ x: 100, y: 50, width: 300, height: 150 });
  });

  it('лівий верхній теж, але рамка росте в інший бік', () => {
    expect(at('top-left', 50, 20)).toMatchObject({ x: 50, y: 20, width: 250, height: 130 });
  });

  it('ребро не чіпає другу вісь', () => {
    expect(at('middle-right', 400, 999)).toMatchObject({ x: 100, y: 50, width: 300, height: 100 });
    expect(at('bottom-center', 999, 400)).toMatchObject({ x: 100, y: 50, width: 200, height: 350 });
  });
});

describe('приніжна зона й переворот', () => {
  // курсор рухається в межах порога від нерухомої точки (100, 50)
  const inZone = [0.1, 0.5, 0.9, 0.3, 0.7].map((k) => 100 + k * MIN_SIZE);

  it('поки курсор у зоні, рамка щокадру ТА САМА — і розмір, і місце', () => {
    const frames = inZone.map((x) => at('bottom-right', x, 50 + MIN_SIZE * 0.5));
    for (const f of frames) {
      expect(f.width).toBe(MIN_SIZE);
      expect(f.height).toBe(MIN_SIZE);
      expect(f.x).toBe(100);
      expect(f.y).toBe(50);
      expect(f.mirroredX).toBe(false);
    }
  });

  it('з іншого боку — так само нерухомо, але вже дзеркально', () => {
    const frames = inZone.map((x) => at('bottom-right', 200 - x, 50 - MIN_SIZE * 0.5));
    for (const f of frames) {
      expect(f.width).toBe(MIN_SIZE);
      expect(f.x).toBe(100 - MIN_SIZE);
      expect(f.mirroredX).toBe(true);
    }
  });

  it('перехід через нерухому точку — за один крок, без проміжного стану', () => {
    const before = at('bottom-right', 100.5, 100);
    const after = at('bottom-right', 99.5, 100);
    expect(before.x).toBe(100);
    expect(after.x).toBe(100 - MIN_SIZE);
    expect(before.width).toBe(after.width);
    expect(before.mirroredX).toBe(false);
    expect(after.mirroredX).toBe(true);
  });

  it('одразу далеко за точкою — повний розмір тієї ж миті', () => {
    expect(at('bottom-right', 100 - 240, 50)).toMatchObject({ x: -140, width: 240, mirroredX: true });
  });

  it('нерухома точка не рухається ні на якому курсорі', () => {
    for (const dx of [300, 120, 40, 8, 1, -1, -8, -40, -120, -300]) {
      const f = at('bottom-right', 100 + dx, 50 + dx);
      const anchorX = f.mirroredX ? f.x + f.width : f.x;
      const anchorY = f.mirroredY ? f.y + f.height : f.y;
      expect(anchorX).toBe(100);
      expect(anchorY).toBe(50);
    }
  });

  // у лівої ручки «нормальний» бік протилежний — дзеркалення рахується від нього
  it('для лівої ручки дзеркалення рахується від її власного боку', () => {
    expect(at('top-left', 50, 20).mirroredX).toBe(false);
    expect(at('top-left', 350, 20).mirroredX).toBe(true);
  });
});

describe('заблокована пропорція', () => {
  const img: Rect = { x: 0, y: 0, width: 200, height: 300 }; // 2:3
  const imgGrip = gripFor(img, 0, 'bottom-right');
  const exact = (r: { width: number; height: number }) => r.width / r.height;

  it('відношення сторін те саме на БУДЬ-ЯКОМУ курсорі, включно з порогом', () => {
    for (const d of [600, 300, 100, 40, 10, 1, 0, -1, -40, -300]) {
      const out = resizeFromPointer(imgGrip, { x: d, y: d * 1.5 }, true);
      expect(exact(out)).toBeCloseTo(200 / 300, 12);
    }
  });

  it('на порозі рамка не стає квадратною', () => {
    const out = resizeFromPointer(imgGrip, { x: 1, y: 1 }, true);
    expect(Math.min(out.width, out.height)).toBeCloseTo(MIN_SIZE, 9);
    expect(out.width).not.toBeCloseTo(out.height, 6);
  });

  it('стиснули в поріг і назад, десять разів — відношення не зрушило', () => {
    for (let i = 0; i < 10; i++) {
      const down = resizeFromPointer(imgGrip, { x: 2, y: 3 }, true);
      const up = resizeFromPointer(imgGrip, { x: 400, y: 600 }, true);
      expect(exact(down)).toBeCloseTo(200 / 300, 12);
      expect(exact(up)).toBeCloseTo(200 / 300, 12);
    }
  });

  it('після перевороту по одній осі далі росте пропорційно, а не тягнеться', () => {
    const a = resizeFromPointer(imgGrip, { x: -100, y: 150 }, true);
    const b = resizeFromPointer(imgGrip, { x: -200, y: 300 }, true);
    expect(exact(a)).toBeCloseTo(200 / 300, 12);
    expect(exact(b)).toBeCloseTo(200 / 300, 12);
    expect(b.width).toBeGreaterThan(a.width);
    expect(a.mirroredX).toBe(true);
    expect(a.mirroredY).toBe(false);
  });

  it('дзеркалення по осях лишається незалежним, хоч розмір і спільний', () => {
    expect(resizeFromPointer(imgGrip, { x: -300, y: 300 }, true)).toMatchObject({
      mirroredX: true,
      mirroredY: false,
    });
    expect(resizeFromPointer(imgGrip, { x: 300, y: -300 }, true)).toMatchObject({
      mirroredX: false,
      mirroredY: true,
    });
  });
});

describe('група обʼєктів', () => {
  const from: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const item: Rect = { x: 50, y: 0, width: 50, height: 50 };

  it('одинокий обʼєкт лягає рівно в рамку', () => {
    const box = { x: 10, y: 20, width: 200, height: 300, mirroredX: false, mirroredY: false };
    expect(mapIntoBox(from, from, box)).toMatchObject({ x: 10, y: 20, width: 200, height: 300 });
  });

  it('при дзеркаленні обʼєкти всередині теж міняються місцями', () => {
    const box = { x: 0, y: 0, width: 100, height: 100, mirroredX: true, mirroredY: false };
    expect(mapIntoBox(item, from, box)).toMatchObject({ x: 0, width: 50 });
  });
});

describe('товщина обведення', () => {
  it('росте пропорційно до розміру', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 100, height: 100 }, { width: 200, height: 200 })).toBe(4);
  });

  it('рахується від початку жесту, тому прохід крізь поріг її не розганяє', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    for (const w of [200, 60, MIN_SIZE, 60, 200, 260]) {
      expect(scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 })).toBeLessThanOrEqual(2);
    }
    expect(scaledStrokeWidth(start, { width: 260, height: 160 })).toBe(2);
  });

  it('за межі допустимого не виходить', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 10, height: 10 }, { width: 5000, height: 5000 })).toBe(20);
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 500, height: 500 }, { width: 8, height: 8 })).toBe(1);
  });
});
