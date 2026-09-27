import { describe, expect, it } from 'vitest';
import type { BoardObject } from 'shared';
import { DEFAULT_INK } from '../theme';
import { inkOverFill } from './ink-over-fill';

const base = { rotation: 0, createdBy: 'u1', createdAt: '2026-09-27T10:00:00.000Z' };

const sticky = (id: string, x: number, y: number, zIndex: number): BoardObject =>
  ({
    ...base,
    id,
    x,
    y,
    width: 160,
    height: 120,
    zIndex,
    type: 'sticky',
    text: '',
    fillColor: '#fef08a',
    textColor: DEFAULT_INK,
    column: null,
  }) as BoardObject;

const text = (id: string, x: number, y: number, zIndex: number, color = DEFAULT_INK): BoardObject =>
  ({
    ...base,
    id,
    x,
    y,
    width: 60,
    height: 24,
    zIndex,
    type: 'text',
    text: 'Текст',
    fontSize: 18,
    color,
    autoWidth: true,
    minHeight: 0,
  }) as BoardObject;

const shape = (id: string, x: number, y: number, zIndex: number, fillColor = '#ffffff'): BoardObject =>
  ({
    ...base,
    id,
    x,
    y,
    width: 120,
    height: 90,
    zIndex,
    type: 'shape',
    shapeKind: 'rect',
    fillColor,
    strokeColor: DEFAULT_INK,
    strokeWidth: 2,
  }) as BoardObject;

const connector = (id: string, x: number, y: number, width: number, zIndex: number): BoardObject =>
  ({
    ...base,
    id,
    x,
    y,
    width,
    height: 0,
    zIndex,
    type: 'connector',
    points: [
      { x, y },
      { x: x + width, y },
    ],
    strokeColor: DEFAULT_INK,
    strokeWidth: 2,
    arrowEnd: true,
  }) as BoardObject;

describe('inkOverFill', () => {
  it('текст на голому полотні — ні, на стікері — так', () => {
    const objects = [sticky('s', 0, 0, 1), text('bare', 500, 500, 2), text('on', 40, 40, 3)];
    expect([...inkOverFill(objects)]).toEqual(['on']);
  });

  it('лише поверх нижчого за z: стікер, покладений поверх тексту, текст уже закриває', () => {
    const objects = [text('t', 40, 40, 1), sticky('s', 0, 0, 2)];
    expect(inkOverFill(objects).size).toBe(0);
  });

  it('свій колір не чіпаємо — його тема й так не підмінює', () => {
    const objects = [sticky('s', 0, 0, 1), text('red', 40, 40, 2, '#fca5a5')];
    expect(inkOverFill(objects).size).toBe(0);
  });

  it('контур фігури на білій фігурі — так; фігура без заливки не рахується', () => {
    const objects = [
      shape('under', 0, 0, 1),
      shape('over', 20, 20, 2),
      shape('hollow', 500, 0, 3, 'transparent'),
      text('in-hollow', 520, 20, 4),
    ];
    expect([...inkOverFill(objects)].sort()).toEqual(['over']);
  });

  it('зʼєднувач між двома стікерами торкається їх лише кінцями — лежить на полотні', () => {
    const objects = [sticky('a', 0, 0, 1), sticky('b', 400, 0, 2), connector('c', 160, 60, 240, 3)];
    expect(inkOverFill(objects).size).toBe(0);
  });
});
