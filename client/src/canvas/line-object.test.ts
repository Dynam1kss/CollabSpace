import { afterEach, describe, expect, it } from 'vitest';
import { CELL_SIZE } from 'shared';
import type { LineObject } from 'shared';
import { boardUndo, cellDocs, cellUndo, resetBoardDoc, useBoardStore } from './board-store';
import { undoBoard, redoBoard } from './board-undo';
import { movedLine } from './objects/line-geometry';
import { withEnds } from './objects/point-box';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// пряма — окремий тип обʼєкта (06.10). Тут перевіряємо, що вона живе за тими
// самими правилами, що й решта: синхронізація, undo, переїзд між клітинками

const line = (id: string, from: { x: number; y: number }, to: { x: number; y: number }): LineObject => ({
  id,
  type: 'line',
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  strokeColor: '#1f2937',
  strokeWidth: 2,
  ...withEnds(from, to),
});

const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const get = (id: string) => useBoardStore.getState().getById(id) as LineObject | undefined;

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('пряма як звичайний обʼєкт дошки', () => {
  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: створення й правка властивостей лягають у документ`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', { x: 100, y: 100 }, { x: 300, y: 200 }));

      useBoardStore.getState().update('l', { dash: 'dashed', arrowEnd: true, strokeWidth: 6 });

      const stored = strategy === 'aoi' ? cellDocs.objectsOf(['0:0']).find((o) => o.id === 'l') : get('l');
      expect(stored).toMatchObject({
        type: 'line',
        dash: 'dashed',
        arrowEnd: true,
        strokeWidth: 6,
        from: { x: 100, y: 100 },
        to: { x: 300, y: 200 },
      });
    });

    it(`${strategy}: зсув рухає обидва кінці й рамку`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', { x: 100, y: 100 }, { x: 300, y: 200 }));

      useBoardStore.getState().update('l', movedLine(get('l')!, 50, 20));

      expect(get('l')).toMatchObject({
        from: { x: 150, y: 120 },
        to: { x: 350, y: 220 },
        x: 150,
        y: 120,
        width: 200,
        height: 100,
      });
    });

    it(`${strategy}: правка прямої відкочується одним ctrl+z, ctrl+y вертає`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', { x: 0, y: 0 }, { x: 100, y: 0 }));
      await realWait(PAUSE_MS);

      useBoardStore.getState().update('l', { dash: 'dotted' });
      expect(get('l')).toMatchObject({ dash: 'dotted' });
      const steps = strategy === 'aoi' ? null : boardUndo.undoStack.length;

      undoBoard();
      expect(get('l')?.dash).toBeUndefined();
      if (steps !== null) expect(boardUndo.undoStack.length).toBe(steps - 1);
      else expect(cellUndo.canRedo).toBe(true);

      redoBoard();
      expect(get('l')).toMatchObject({ dash: 'dotted' });
    });

    it(`${strategy}: видалення й відкат видалення`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(line('l', { x: 0, y: 0 }, { x: 100, y: 50 }));
      await realWait(PAUSE_MS);

      useBoardStore.getState().remove('l');
      expect(get('l')).toBeUndefined();

      undoBoard();
      expect(get('l')).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 100, y: 50 } });
    });
  }

  // клітинка рахується за центром рамки, тож пряма переїжджає між клітинками
  // так само, як будь-що інше — і одним кроком undo, бо це один жест
  it('стратегія 3: пряма переїжджає в сусідню клітинку', async () => {
    setSyncStrategy('aoi');
    resetBoardDoc();
    // центр (200,100) — клітинка 0:0
    useBoardStore.getState().add(line('l', { x: 100, y: 100 }, { x: 300, y: 100 }));
    expect(cellDocs.openCells()).toEqual(['0:0']);
    await realWait(PAUSE_MS);

    // центр їде за CELL_SIZE — це вже 1:0
    useBoardStore.getState().update('l', movedLine(get('l')!, CELL_SIZE, 0));
    expect(cellDocs.openCells()).toContain('1:0');
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(0);
    expect(get('l')).toMatchObject({ from: { x: CELL_SIZE + 100, y: 100 } });

    undoBoard();
    expect(get('l')).toMatchObject({ from: { x: 100, y: 100 } });
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(0);
  });

  it('z-порядок і замок — ті самі поля, що в решти типів', () => {
    resetBoardDoc();
    useBoardStore.getState().add(line('l', { x: 0, y: 0 }, { x: 10, y: 10 }));
    useBoardStore.getState().update('l', { zIndex: 7, locked: true });
    expect(get('l')).toMatchObject({ zIndex: 7, locked: true });
  });
});
