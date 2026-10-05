import { afterEach, describe, expect, it } from 'vitest';
import { textAlign } from 'shared';
import type { StickyObject, TextObject } from 'shared';
import { boardUndo, cellDocs, cellUndo, resetBoardDoc, useBoardStore } from './board-store';
import { undoBoard, redoBoard } from './board-undo';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// 06.10: вирівнювання тексту не було зовсім. Поле необовʼязкове — усе,
// намальоване раніше, лишається вирівняним вліво й без поля в базі

const text = (id: string, extra: Partial<TextObject> = {}): TextObject => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  width: 200,
  height: 40,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  text: 'рядок',
  fontSize: 18,
  color: '#1f2937',
  autoWidth: false,
  minHeight: 0,
  ...extra,
});

const sticky = (id: string, extra: Partial<StickyObject> = {}): StickyObject => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  text: 'рядок',
  fillColor: '#fef08a',
  textColor: '#1f2937',
  column: null,
  ...extra,
});

const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('запас вирівнювання', () => {
  it('обʼєкт без поля — вліво', () => {
    expect(textAlign(text('a'))).toBe('left');
    expect(textAlign(sticky('b'))).toBe('left');
    expect(textAlign({})).toBe('left');
  });

  it('задане значення перебиває запас', () => {
    expect(textAlign(text('a', { align: 'center' }))).toBe('center');
    expect(textAlign(sticky('b', { align: 'right' }))).toBe('right');
  });
});

describe('вирівнювання синхронізується як звичайна властивість', () => {
  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: правка лягає в документ`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(text('t'));
      useBoardStore.getState().add(sticky('s'));

      useBoardStore.getState().update('t', { align: 'center' });
      useBoardStore.getState().update('s', { align: 'right' });

      const stored =
        strategy === 'aoi'
          ? Object.fromEntries(cellDocs.objectsOf(['0:0']).map((o) => [o.id, o]))
          : Object.fromEntries(
              useBoardStore
                .getState()
                .getAll()
                .map((o) => [o.id, o]),
            );
      expect(stored['t']).toMatchObject({ align: 'center' });
      expect(stored['s']).toMatchObject({ align: 'right' });
    });

    it(`${strategy}: зміна вирівнювання — один крок ctrl+z, і ctrl+y його вертає`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(text('t'));
      await realWait(PAUSE_MS);

      useBoardStore.getState().update('t', { align: 'right' });
      expect(textAlign(useBoardStore.getState().getById('t') as TextObject)).toBe('right');
      const steps = strategy === 'aoi' ? null : boardUndo.undoStack.length;

      undoBoard();
      expect(textAlign(useBoardStore.getState().getById('t') as TextObject)).toBe('left');
      if (steps !== null) expect(boardUndo.undoStack.length).toBe(steps - 1);
      else expect(cellUndo.canRedo).toBe(true);

      redoBoard();
      expect(textAlign(useBoardStore.getState().getById('t') as TextObject)).toBe('right');
    });
  }

  // панель міняє вирівнювання всьому виділеному, де воно є
  it('кілька обʼєктів разом', () => {
    resetBoardDoc();
    useBoardStore.getState().add(text('t'));
    useBoardStore.getState().add(sticky('s'));

    for (const id of ['t', 's']) useBoardStore.getState().update(id, { align: 'center' });

    expect(textAlign(useBoardStore.getState().getById('t') as TextObject)).toBe('center');
    expect(textAlign(useBoardStore.getState().getById('s') as StickyObject)).toBe('center');
  });
});
