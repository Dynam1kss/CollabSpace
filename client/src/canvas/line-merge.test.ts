import { afterEach, describe, expect, it } from 'vitest';
import { CELL_SIZE, connectorCurved } from 'shared';
import type { ConnectorObject, LineObject } from 'shared';
import { cellDocs, resetBoardDoc, useBoardStore } from './board-store';
import { undoBoard, redoBoard } from './board-undo';
import { withEnds, withPoints } from './objects/point-box';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// лінія й конектор стали одним інструментом (06.10). Перевіряємо дві речі:
// нова лінія вміє все, що вміла стара, і дошки, намальовані ДО обʼєднання,
// лишаються робочими — і старі 'line', і старі 'connector' без нових полів

const connector = (id: string, points: { x: number; y: number }[]): ConnectorObject => ({
  id,
  type: 'connector',
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  arrowEnd: true,
  ...withPoints(points),
});

const oldLine = (id: string): LineObject => ({
  id,
  type: 'line',
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  dash: 'dashed',
  arrowStart: true,
  ...withEnds({ x: 0, y: 0 }, { x: 100, y: 50 }),
});

const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const get = <T>(id: string) => useBoardStore.getState().getById(id) as T | undefined;

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('лінія: один тип замість двох інструментів', () => {
  it('нова лінія типово пряма, стара ламана лишається кривою', () => {
    // дві точки — пряма й сплайн малюються однаково, тож поля ще немає
    expect(connectorCurved(connector('a', [{ x: 0, y: 0 }, { x: 10, y: 0 }]))).toBe(false);
    // три точки без поля — це намальоване до обʼєднання, і воно було кривим
    expect(
      connectorCurved(connector('b', [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }])),
    ).toBe(true);
    // явне поле переважує завжди
    expect(connectorCurved({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], curved: true })).toBe(true);
    expect(
      connectorCurved({ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 0 }], curved: false }),
    ).toBe(false);
  });

  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: штрих, вістря й вигляд лінії лягають у документ`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(connector('c', [{ x: 10, y: 10 }, { x: 200, y: 80 }]));

      useBoardStore.getState().update('c', { dash: 'dotted', arrowStart: true, curved: true });

      const stored =
        strategy === 'aoi'
          ? (cellDocs.objectsOf(['0:0']).find((o) => o.id === 'c') as ConnectorObject)
          : get<ConnectorObject>('c');
      expect(stored).toMatchObject({ type: 'connector', dash: 'dotted', arrowStart: true, curved: true });
      expect(connectorCurved(stored!)).toBe(true);
    });

    it(`${strategy}: перемикання режиму зберігає всі точки в обидва боки`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      const points = [
        { x: 0, y: 0 },
        { x: 50, y: 60 },
        { x: 120, y: 0 },
      ];
      useBoardStore.getState().add(connector('c', points));
      await realWait(PAUSE_MS);

      // саме це робить перемикач у панелі: міняється лише режим
      useBoardStore.getState().update('c', { curved: false });
      const straight = get<ConnectorObject>('c')!;
      expect(straight.points).toHaveLength(3);
      expect(straight.points[1]).toEqual({ x: 50, y: 60 });
      expect(connectorCurved(straight)).toBe(false);

      // пауза довша за вікно групування undo — інакше обидва перемикання
      // злились би в один крок, і перевірка нижче нічого б не доводила
      await realWait(PAUSE_MS);
      useBoardStore.getState().update('c', { curved: true });
      const back = get<ConnectorObject>('c')!;
      expect(back.points).toHaveLength(3);
      expect(connectorCurved(back)).toBe(true);

      // один перемикач — один крок undo
      undoBoard();
      expect(connectorCurved(get<ConnectorObject>('c')!)).toBe(false);
      expect(get<ConnectorObject>('c')!.points).toHaveLength(3);
      redoBoard();
      expect(connectorCurved(get<ConnectorObject>('c')!)).toBe(true);
    });

    it(`${strategy}: стара пряма 'line' досі читається й правиться`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(oldLine('l'));
      expect(get<LineObject>('l')).toMatchObject({ type: 'line', dash: 'dashed', arrowStart: true });

      useBoardStore.getState().update('l', { strokeWidth: 6, dash: 'dotted' });
      expect(get<LineObject>('l')).toMatchObject({ strokeWidth: 6, dash: 'dotted' });
    });
  }

  it('стратегія 3: лінія переїжджає в сусідню клітинку одним кроком undo', async () => {
    setSyncStrategy('aoi');
    resetBoardDoc();
    useBoardStore.getState().add(connector('c', [{ x: 100, y: 100 }, { x: 300, y: 100 }]));
    expect(cellDocs.openCells()).toEqual(['0:0']);
    await realWait(PAUSE_MS);

    useBoardStore.getState().update(
      'c',
      withPoints([
        { x: CELL_SIZE + 100, y: 100 },
        { x: CELL_SIZE + 300, y: 100 },
      ]),
    );
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(0);

    undoBoard();
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(0);
  });

  it('замок і z-порядок — ті самі поля', () => {
    resetBoardDoc();
    useBoardStore.getState().add(connector('c', [{ x: 0, y: 0 }, { x: 10, y: 10 }]));
    useBoardStore.getState().update('c', { zIndex: 4, locked: true });
    expect(get<ConnectorObject>('c')).toMatchObject({ zIndex: 4, locked: true });
  });
});
