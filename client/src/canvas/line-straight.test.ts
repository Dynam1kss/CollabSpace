import { afterEach, describe, expect, it } from 'vitest';
import { connectorCurved } from 'shared';
import type { ConnectorObject } from 'shared';
import { cellDocs, resetBoardDoc, useBoardStore } from './board-store';
import { connectorTension, midpoints } from './objects/connector-geometry';
import { withPoints } from './objects/point-box';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// пряма ламана виглядала кривою на ЧУЖОМУ екрані: обведення чужого виділення
// й «середні» ручки рахувались окремо від самої лінії й завжди зі сплайном.
// Тепер режим читається з однієї функції, а на створенні поле пишеться явно

const line = (id: string, points: { x: number; y: number }[], curved?: boolean): ConnectorObject => ({
  id,
  type: 'connector',
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  arrowEnd: true,
  ...(curved === undefined ? {} : { curved }),
  ...withPoints(points),
});

const ZIGZAG = [
  { x: 0, y: 0 },
  { x: 100, y: 100 },
  { x: 200, y: 0 },
];

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('пряма ламана: один режим для обведення, ручок і самої лінії', () => {
  it('середні ручки лежать рівно на відрізках, коли лінія пряма', () => {
    const mids = midpoints(ZIGZAG, false);
    expect(mids).toEqual([
      { x: 50, y: 50 },
      { x: 150, y: 50 },
    ]);
  });

  it('у двох точок режим не важить — там і сплайн, і пряма збігаються', () => {
    const two = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ];
    expect(midpoints(two, true)).toEqual(midpoints(two, false));
  });

  it('тензія береться з режиму, а не з кількості точок', () => {
    expect(connectorTension(line('a', ZIGZAG, false))).toBe(0);
    expect(connectorTension(line('a', ZIGZAG, true))).toBeGreaterThan(0);
    // поля немає зовсім — лише тоді вмикається здогад за кількістю точок
    expect(connectorTension(line('a', ZIGZAG))).toBeGreaterThan(0);
    expect(
      connectorTension(
        line('a', [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ),
    ).toBe(0);
  });

  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: пряма ламана доїжджає до сусіда саме прямою`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', ZIGZAG, false));

      // те, що справді лягло в документ і піде в мережу
      const sent =
        strategy === 'aoi'
          ? (cellDocs.objectsOf(['0:0']).find((o) => o.id === 'l') as ConnectorObject)
          : (useBoardStore.getState().getById('l') as ConnectorObject);

      expect(sent.curved, 'поле мусить бути в документі, а не лише в памʼяті').toBe(false);
      expect(connectorCurved(sent)).toBe(false);
      expect(connectorTension(sent)).toBe(0);
      expect(midpoints(sent.points, connectorCurved(sent))).toEqual([
        { x: 50, y: 50 },
        { x: 150, y: 50 },
      ]);
    });

    it(`${strategy}: додавання середньої точки не робить пряму кривою`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', [ZIGZAG[0], ZIGZAG[2]], false));

      // саме це робить тягання за середню ручку
      useBoardStore.getState().update('l', withPoints(ZIGZAG));

      const stored = useBoardStore.getState().getById('l') as ConnectorObject;
      expect(stored.points).toHaveLength(3);
      expect(connectorCurved(stored)).toBe(false);
    });
  }
});
