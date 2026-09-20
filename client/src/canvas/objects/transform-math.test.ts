import { describe, expect, it } from 'vitest';
import { MIN_SIZE, bakedSide, limitBoxSize, scaledStrokeWidth } from './transform-math';

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height, rotation: 0 });

describe('нижня межа розміру', () => {
  it('відʼємну ширину пропускає — це дзеркалення, а не помилка', () => {
    const next = box(-120, 80);
    expect(limitBoxSize(box(200, 80), next)).toBe(next);
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
