import { describe, expect, it } from 'vitest';
import type { BoardObject } from 'shared';
import { centerOnObject, searchObjects } from './board-search';

const base = {
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-09-22T10:00:00.000Z',
};

const sticky = (id: string, text: string, zIndex = 0): BoardObject =>
  ({ ...base, id, zIndex, type: 'sticky', text, fillColor: '#fff', textColor: '#000' }) as BoardObject;

const textObj = (id: string, text: string, zIndex = 0): BoardObject =>
  ({
    ...base,
    id,
    zIndex,
    type: 'text',
    text,
    color: '#000',
    fontSize: 16,
    autoWidth: true,
    minHeight: 20,
  }) as BoardObject;

const shape = (id: string): BoardObject =>
  ({ ...base, id, type: 'shape', shapeKind: 'rect', fillColor: '#fff', strokeColor: '#000', strokeWidth: 2 }) as BoardObject;

describe('пошук по дошці', () => {
  it('порожній запит нічого не знаходить', () => {
    expect(searchObjects([sticky('a', 'привіт')], '   ')).toEqual([]);
  });

  it('шукає підрядок без урахування регістру', () => {
    const hits = searchObjects([sticky('a', 'Плани на Квітень'), sticky('b', 'бюджет')], 'КВІТ');
    expect(hits.map((h) => h.id)).toEqual(['a']);
  });

  it('бере і стікери, і текстові блоки', () => {
    const hits = searchObjects([sticky('a', 'звіт'), textObj('b', 'ЗВІТ за рік')], 'звіт');
    expect(hits.map((h) => h.type).sort()).toEqual(['sticky', 'text']);
  });

  it('обʼєкти без тексту не шукаються навіть за збігом в id', () => {
    expect(searchObjects([shape('фігура')], 'фігура')).toEqual([]);
  });

  it('порядок — за z, щоб список не стрибав', () => {
    const hits = searchObjects([sticky('c', 'нота', 5), sticky('a', 'нота', 1), sticky('b', 'нота', 3)], 'нота');
    expect(hits.map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });

  it('довгий текст обрізається, переноси рядків згортаються', () => {
    const long = 'рядок один\nрядок два і ще багато слів, які точно не влізуть у вузький попап';
    const [hit] = searchObjects([sticky('a', long)], 'рядок');
    expect(hit.snippet.length).toBeLessThanOrEqual(43);
    expect(hit.snippet).not.toContain('\n');
    expect(hit.snippet.endsWith('…')).toBe(true);
  });

  it('короткий текст лишається цілим, без трьох крапок', () => {
    const [hit] = searchObjects([sticky('a', 'коротко')], 'корот');
    expect(hit.snippet).toBe('коротко');
  });
});

describe('центрування на обʼєкті', () => {
  const obj = { ...base, id: 'a', x: 200, y: 100, width: 100, height: 80, type: 'sticky' } as BoardObject;

  it('центр обʼєкта стає центром полотна', () => {
    const next = centerOnObject(obj, { x: 0, y: 0, scale: 1 }, 800, 600);
    // центр обʼєкта — (250, 140); на екрані він має лягти в (400, 300)
    expect(next.x + 250 * next.scale).toBe(400);
    expect(next.y + 140 * next.scale).toBe(300);
  });

  it('масштаб не чіпаємо — людина сама вибрала, як близько дивиться', () => {
    expect(centerOnObject(obj, { x: 0, y: 0, scale: 2.5 }, 800, 600).scale).toBe(2.5);
  });

  it('працює і на віддаленому масштабі', () => {
    const next = centerOnObject(obj, { x: 123, y: -45, scale: 0.25 }, 400, 400);
    expect(next.x + 250 * 0.25).toBe(200);
    expect(next.y + 140 * 0.25).toBe(200);
  });
});
