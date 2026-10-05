import { describe, expect, it } from 'vitest';
import { lineDash } from 'shared';
import type { LineObject } from 'shared';
import { dashPattern, lineLength, movedLine } from './line-geometry';
import { withEnds } from './point-box';

const line = (from: { x: number; y: number }, to: { x: number; y: number }): LineObject => ({
  id: 'l',
  type: 'line',
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  ...withEnds(from, to),
});

describe('рамка прямої по її кінцях', () => {
  it('зліва направо й згори вниз', () => {
    expect(withEnds({ x: 10, y: 20 }, { x: 110, y: 70 })).toMatchObject({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  // кінці можуть іти в будь-який бік — рамка однакова
  it('у зворотний бік рамка та сама', () => {
    const a = withEnds({ x: 10, y: 20 }, { x: 110, y: 70 });
    const b = withEnds({ x: 110, y: 70 }, { x: 10, y: 20 });
    expect([b.x, b.y, b.width, b.height]).toEqual([a.x, a.y, a.width, a.height]);
    // а самі кінці не переставляються: напрямок важливий для вістря
    expect(b.from).toEqual({ x: 110, y: 70 });
  });

  it('строго горизонтальна й вертикальна — вироджена сторона нульова', () => {
    expect(withEnds({ x: 0, y: 5 }, { x: 100, y: 5 })).toMatchObject({ height: 0, width: 100 });
    expect(withEnds({ x: 5, y: 0 }, { x: 5, y: 100 })).toMatchObject({ width: 0, height: 100 });
  });
});

describe('штрих', () => {
  it('без поля — суцільна, і візерунка немає', () => {
    expect(lineDash(line({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe('solid');
    expect(dashPattern({ strokeWidth: 2 })).toBeUndefined();
  });

  it('штрихова й крапкова ростуть разом із товщиною', () => {
    const thin = dashPattern({ dash: 'dashed', strokeWidth: 2 })!;
    const thick = dashPattern({ dash: 'dashed', strokeWidth: 8 })!;
    expect(thick[0]).toBeGreaterThan(thin[0]);
    // крапка — майже нульовий сегмент із круглим кінцем
    expect(dashPattern({ dash: 'dotted', strokeWidth: 2 })![0]).toBeLessThan(1);
  });

  // нульова товщина не має дати нульовий візерунок: konva з ним зациклюється
  it('нульова товщина не дає нульових сегментів', () => {
    for (const d of ['dashed', 'dotted'] as const) {
      for (const n of dashPattern({ dash: d, strokeWidth: 0 })!) expect(n).toBeGreaterThan(0);
    }
  });
});

describe('зсув прямої', () => {
  it('їдуть обидва кінці й рамка разом із ними', () => {
    const moved = movedLine(line({ x: 10, y: 10 }, { x: 60, y: 40 }), 5, -3);
    expect(moved.from).toEqual({ x: 15, y: 7 });
    expect(moved.to).toEqual({ x: 65, y: 37 });
    expect({ x: moved.x, y: moved.y }).toEqual({ x: 15, y: 7 });
  });

  it('довжина від зсуву не міняється', () => {
    const l = line({ x: 0, y: 0 }, { x: 30, y: 40 });
    expect(lineLength(l)).toBe(50);
    expect(lineLength(movedLine(l, 100, -100) as LineObject)).toBe(50);
  });
});
