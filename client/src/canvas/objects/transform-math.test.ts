import { describe, expect, it } from 'vitest';
import { MIN_SIZE, bakedSide, limitBoxSize, scaledStrokeWidth } from './transform-math';

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height, rotation: 0 });

describe('нижня межа розміру', () => {
  // відʼємна сторона — це дзеркалення, тож кадр приймаємо. Але НЕ віддаємо
  // знак конві: саме з нього виростало подвійне дзеркалення на різкому маху
  it('відʼємну ширину приймає, але віддає нормалізованою', () => {
    const out = limitBoxSize(box(200, 80), box(-120, 80));
    expect(out.width).toBe(120);
    expect(out.x).toBe(-120);
    expect(out.height).toBe(80);
  });

  it('вироджений кадр відкидає, лишаючи попередній', () => {
    const prev = box(200, 80);
    expect(limitBoxSize(prev, box(3, 80))).toBe(prev);
    expect(limitBoxSize(prev, box(-3, 80))).toBe(prev);
    expect(limitBoxSize(prev, box(200, -2))).toBe(prev);
  });
});

describe('запікання scale у розмір', () => {
  it('відʼємний scale дає додатний розмір тієї ж величини', () => {
    expect(bakedSide(100, -1.5)).toBe(150);
    expect(bakedSide(100, 1.5)).toBe(150);
  });

  it('нижче порога не опускається', () => {
    expect(bakedSide(100, -0.01)).toBe(MIN_SIZE);
  });
});

describe('товщина обведення при зміні розміру', () => {
  it('росте пропорційно до розміру', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 100, height: 100 }, { width: 200, height: 200 })).toBe(4);
  });

  // саме те, на що скаржились: кілька проходів повз протилежну ручку
  // підряд розганяли обведення до максимуму
  it('не накопичується за багато кадрів із проходом крізь нуль', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    // кадри одного жесту: стискання до порога, дзеркалення, ріст назад
    const frames = [200, 120, 60, 20, MIN_SIZE, MIN_SIZE, 20, 60, 120, 200, 260];
    let last = 0;
    for (const w of frames) {
      last = scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 });
      expect(last).toBeLessThan(20);
    }
    // повернулись у вихідний розмір — і товщина та сама, що була
    expect(last).toBe(2);
  });

  it('десять перетинів поспіль не впираються в максимум', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    for (let i = 0; i < 10; i++) {
      for (const w of [260, 40, MIN_SIZE, 40, 260]) {
        expect(scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 })).toBeLessThanOrEqual(2);
      }
    }
  });

  it('за межі допустимого не виходить', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 10, height: 10 }, { width: 5000, height: 5000 })).toBe(20);
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 500, height: 500 }, { width: 8, height: 8 })).toBe(1);
  });
});

// РІЗКИЙ мах: одна подія миші з дельтою в сотні пікселів перестрибує
// приніжну зону цілком, і конва віддає одразу велику ВІДʼЄМНУ рамку.
// За модулем вона не вироджена, тому поріг її пропускає — і саме тут
// починався розвал: побачивши відʼємну ширину, конва перейменовує активну
// ручку І віддає відʼємний scale, який decompose() робить поворотом 180°.
// Два дзеркалення поспіль — і активною стає ручка, що мала стояти нерухомо
describe('різкий мах через нуль', () => {
  const fixed = { x: 429, y: 349 };

  it('велику відʼємну рамку не відкидає, а нормалізує', () => {
    const out = limitBoxSize(box(262, 162), { ...box(-300, -180), x: fixed.x, y: fixed.y });
    expect(out.width).toBe(300);
    expect(out.height).toBe(180);
    // початок переїхав на справжній лівий верхній кут
    expect(out.x).toBeCloseTo(129, 6);
    expect(out.y).toBeCloseTo(169, 6);
  });

  it('нерухомий кут лишається на місці й туди, і назад', () => {
    // мах за протилежний кут…
    const a = limitBoxSize(box(262, 162), { ...box(-300, -180), x: fixed.x, y: fixed.y });
    expect(a.x + a.width).toBeCloseTo(fixed.x, 6);
    expect(a.y + a.height).toBeCloseTo(fixed.y, 6);
    // …і різко назад: конва знову дає відʼємну рамку, вже від нової точки
    const b = limitBoxSize(a, { ...box(-300, -180), x: fixed.x + 300, y: fixed.y + 180 });
    expect(b.x).toBeCloseTo(fixed.x, 6);
    expect(b.y).toBeCloseTo(fixed.y, 6);
    expect(b.width).toBe(300);
    expect(b.height).toBe(180);
  });

  it('десять різких махів поспіль не зсувають нерухомий кут', () => {
    let prev = box(262, 162);
    for (let i = 0; i < 10; i++) {
      const out = limitBoxSize(prev, { ...box(-300, -180), x: fixed.x, y: fixed.y });
      expect(out.x + out.width).toBeCloseTo(fixed.x, 6);
      expect(out.y + out.height).toBeCloseTo(fixed.y, 6);
      expect(out.width).toBe(300);
      prev = out;
    }
  });

  // саме цей інваріант і ламав подвійне дзеркалення
  it('назовні ніколи не виходить рамка з відʼємною стороною', () => {
    for (const w of [-900, -300, -9, 9, 300, 900]) {
      for (const h of [-900, -180, -9, 9, 180, 900]) {
        const out = limitBoxSize(box(262, 162), { ...box(w, h), x: 429, y: 349 });
        expect(out.width).toBeGreaterThan(0);
        expect(out.height).toBeGreaterThan(0);
      }
    }
  });

  it('при повороті зсув іде вздовж осей самої рамки', () => {
    // повернуто на 90°: відʼємна ширина тягне початок уздовж осі y
    const out = limitBoxSize(box(262, 162), {
      x: 100, y: 200, width: -300, height: 180, rotation: Math.PI / 2,
    });
    expect(out.width).toBe(300);
    expect(out.x).toBeCloseTo(100, 6);
    expect(out.y).toBeCloseTo(-100, 6);
  });

  it('вироджену рамку відкидає й на великій дельті', () => {
    const prev = box(262, 162);
    expect(limitBoxSize(prev, { ...box(-3, -180), x: 429, y: 349 })).toBe(prev);
  });
});
