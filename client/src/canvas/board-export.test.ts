import { describe, expect, it } from 'vitest';
import type { BoardObject } from 'shared';
import { contentBounds } from './fit-to-objects';
import { EXPORT_PADDING, exportFileName, exportFrame, pdfPageSize } from './board-export';

const base = {
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-09-26T10:00:00.000Z',
};

const rect = (id: string, x: number, y: number, width: number, height: number, rotation = 0): BoardObject =>
  ({
    ...base,
    id,
    x,
    y,
    width,
    height,
    rotation,
    type: 'shape',
    shapeKind: 'rect',
    fillColor: '#fff',
    strokeColor: '#000',
    strokeWidth: 2,
  }) as BoardObject;

const ellipse = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
): BoardObject =>
  ({ ...(rect(id, x, y, width, height, rotation) as object), shapeKind: 'ellipse' }) as BoardObject;

describe('межі вмісту', () => {
  it('порожня дошка — null', () => {
    expect(contentBounds([])).toBeNull();
  });

  it('охоплює всі обʼєкти, навіть далеко один від одного', () => {
    const b = contentBounds([rect('a', -500, 20, 100, 50), rect('b', 3000, 1800, 200, 100)]);
    expect(b).toEqual({ minX: -500, minY: 20, maxX: 3200, maxY: 1900 });
  });

  it('повернутий прямокутник крутиться навколо лівого верхнього кута', () => {
    const b = contentBounds([rect('a', 0, 0, 100, 50, 90)])!;
    expect(b.minX).toBeCloseTo(-50);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(100);
  });

  it('еліпс крутиться навколо центру', () => {
    const b = contentBounds([ellipse('a', 0, 0, 100, 50, 90)])!;
    expect(b.minX).toBeCloseTo(25);
    expect(b.maxX).toBeCloseTo(75);
    expect(b.minY).toBeCloseTo(-25);
    expect(b.maxY).toBeCloseTo(75);
  });
});

describe('рамка експорту', () => {
  it('додає відступ з усіх боків і бере pixelRatio 2', () => {
    const f = exportFrame({ minX: 100, minY: 200, maxX: 500, maxY: 400 });
    expect(f).toEqual({
      x: 100 - EXPORT_PADDING,
      y: 200 - EXPORT_PADDING,
      width: 400 + EXPORT_PADDING * 2,
      height: 200 + EXPORT_PADDING * 2,
      pixelRatio: 2,
    });
  });

  it('велика дошка отримує менший pixelRatio і влазить у ліміт канваса', () => {
    const f = exportFrame({ minX: 0, minY: 0, maxX: 20000, maxY: 12000 });
    expect(f.pixelRatio).toBeLessThan(1);
    expect(f.width * f.pixelRatio * f.height * f.pixelRatio).toBeLessThanOrEqual(16_777_216 + 1);
  });

  it('дуже довга смуга впирається в ліміт сторони', () => {
    const f = exportFrame({ minX: 0, minY: 0, maxX: 40000, maxY: 10 });
    expect(f.width * f.pixelRatio).toBeLessThanOrEqual(16_384 + 1e-6);
  });

  it('обʼєкт нульового розміру не дає рамку нульової ширини', () => {
    const f = exportFrame({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(f.width).toBeGreaterThan(EXPORT_PADDING * 2);
  });
});

describe('сторінка pdf', () => {
  it('звичайна дошка — один до одного', () => {
    expect(pdfPageSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it('завелика зменшується з тими самими пропорціями', () => {
    const p = pdfPageSize(28800, 7200);
    expect(p.width).toBe(14400);
    expect(p.height).toBe(3600);
  });
});

describe('імʼя файла', () => {
  const day = new Date(2026, 8, 26, 23, 59);

  it('назва плюс дата', () => {
    expect(exportFileName('TestBoard', day, 'png')).toBe('TestBoard-2026-09-26.png');
  });

  it('кирилиця лишається, пробіли стають дефісами', () => {
    expect(exportFileName('  Спринт 12   ретро ', day, 'pdf')).toBe('Спринт-12-ретро-2026-09-26.pdf');
  });

  it('заборонені у windows символи вирізаються', () => {
    expect(exportFileName('a/b\\c:d*e?"f"<g>|h', day, 'png')).toBe('abcdefgh-2026-09-26.png');
  });

  it('з назви без жодного придатного символу — дефолт', () => {
    expect(exportFileName('???', day, 'png')).toBe('дошка-2026-09-26.png');
    expect(exportFileName('...', day, 'png')).toBe('дошка-2026-09-26.png');
  });

  it('довга назва обрізається', () => {
    const name = exportFileName('x'.repeat(200), day, 'png');
    expect(name).toBe('x'.repeat(60) + '-2026-09-26.png');
  });
});
