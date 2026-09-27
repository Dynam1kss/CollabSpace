import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  cellKey,
  cellOfObject,
  cellOfPoint,
  cellsInRect,
  cellsOfInterest,
  parseCellKey,
} from 'shared';

describe('геометрія клітинок', () => {
  it('точка — у клітинку за floor, відʼємні теж', () => {
    expect(cellOfPoint(0, 0)).toBe('0:0');
    expect(cellOfPoint(CELL_SIZE - 0.01, CELL_SIZE - 0.01)).toBe('0:0');
    expect(cellOfPoint(CELL_SIZE, 0)).toBe('1:0');
    expect(cellOfPoint(-1, -1)).toBe('-1:-1');
    expect(cellOfPoint(-CELL_SIZE, 0)).toBe('-1:0');
  });

  it('обʼєкт — за центром власної рамки', () => {
    // лівий верхній кут у 0:0, але центр уже в 1:0
    expect(cellOfObject({ x: CELL_SIZE - 50, y: 10, width: 160, height: 120 })).toBe('1:0');
    expect(cellOfObject({ x: CELL_SIZE - 200, y: 10, width: 160, height: 120 })).toBe('0:0');
  });

  it('ключ туди й назад', () => {
    expect(parseCellKey(cellKey(-3, 12))).toEqual([-3, 12]);
    expect(parseCellKey('кракозябра')).toBeNull();
  });

  it('прямокутник — усі клітинки, яких торкається', () => {
    expect(cellsInRect({ x: 10, y: 10, width: 100, height: 100 })).toEqual(['0:0']);
    expect(cellsInRect({ x: -10, y: 10, width: 100, height: 100 })).toEqual(['-1:0', '0:0']);
    expect(cellsInRect({ x: 1900, y: 1900, width: 200, height: 200 }).sort()).toEqual([
      '0:0',
      '0:1',
      '1:0',
      '1:1',
    ]);
  });

  it('вікно 100% з запасом — 2×2–3×3 клітинки, не більше', () => {
    // екран 1280×800 посеред клітинки
    const centered = cellsOfInterest({ x: 400, y: 600, width: 1280, height: 800 });
    expect(centered.length).toBeLessThanOrEqual(4);
    // той самий екран на перетині чотирьох
    const corner = cellsOfInterest({ x: CELL_SIZE - 640, y: CELL_SIZE - 400, width: 1280, height: 800 });
    expect(corner.length).toBeGreaterThanOrEqual(4);
    expect(corner.length).toBeLessThanOrEqual(9);
  });

  it('далекі області не перетинаються', () => {
    const a = new Set(cellsOfInterest({ x: 0, y: 0, width: 1280, height: 800 }));
    const b = cellsOfInterest({ x: 5 * CELL_SIZE, y: 5 * CELL_SIZE, width: 1280, height: 800 });
    expect(b.some((k) => a.has(k))).toBe(false);
  });
});
