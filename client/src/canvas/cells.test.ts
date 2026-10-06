import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE,
  cellKey,
  cellOfObject,
  cellOfPoint,
  cellsInRect,
  cellsOfInterest,
  parseCellKey,
  VIEW_MARGIN_MIN,
  viewMargin,
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

  it('запас при 100%: по ширині — половина вікна, по висоті впирається в підлогу', () => {
    // 1280×800 при 100%: половина ширини 640 — більша за чверть клітинки,
    // половина висоти 400 — менша, тому по вертикалі діє мінімум
    expect(viewMargin({ x: 0, y: 0, width: 1280, height: 800 })).toEqual({ mx: 640, my: 500 });
    expect(VIEW_MARGIN_MIN).toBe(CELL_SIZE / 4);
    // набір клітинок при цьому той самий, що й до появи мінімуму: 400 і 500
    // лежать в одній клітинці, тож трафіку це не міняє
    expect(cellsOfInterest({ x: 0, y: 0, width: 1280, height: 800 }).sort()).toEqual([
      '-1:-1',
      '-1:0',
      '0:-1',
      '0:0',
    ]);
  });

  it('запас при 400% на телефоні — чверть клітинки по обох осях', () => {
    // 390×844 при 400% — видимі 97.5×211 одиниць дошки; половина вікна дала б
    // 49×105, тобто десяту частину клітинки
    const view = { x: 1351, y: 300, width: 390 / 4, height: 844 / 4 };
    expect(viewMargin(view)).toEqual({ mx: 500, my: 500 });
  });

  it('при 400% сусідня клітинка в роботі, поки до неї ще далеко', () => {
    const w = 390 / 4;
    const h = 844 / 4;
    // камера посеред клітинки 0:0, права межа видимого — за 451 одиницю до
    // межі клітинки (при 400% це понад 1800px рухів пальцем)
    const view = { x: 1500 - w / 2, y: 300, width: w, height: h };
    expect(view.x + view.width).toBeLessThan(CELL_SIZE - 450);
    expect(cellsOfInterest(view)).toContain('1:0');
  });

  it('далекі області не перетинаються', () => {
    const a = new Set(cellsOfInterest({ x: 0, y: 0, width: 1280, height: 800 }));
    const b = cellsOfInterest({ x: 5 * CELL_SIZE, y: 5 * CELL_SIZE, width: 1280, height: 800 });
    expect(b.some((k) => a.has(k))).toBe(false);
  });
});
