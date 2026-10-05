import { afterEach, describe, expect, it } from 'vitest';
import { STICKY_FONT_SIZE, stickyFontSize } from 'shared';
import type { StickyObject } from 'shared';
import { boardUndo, cellDocs, cellUndo, resetBoardDoc, useBoardStore } from './board-store';
import { undoBoard } from './board-undo';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// 06.10: у стікера не було чим задати розмір тексту — він був прибитий
// числом 16 у вузлі konva. Поле зробили необовʼязковим, щоб дошки, збережені
// раніше, малювались рівно так само

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
  text: 'текст',
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

describe('розмір тексту стікера', () => {
  it('старий стікер без поля читається як 16 — рівно те, чим малювався', () => {
    expect(stickyFontSize(sticky('a'))).toBe(STICKY_FONT_SIZE);
    expect(STICKY_FONT_SIZE).toBe(16);
  });

  it('заданий розмір перебиває запас', () => {
    expect(stickyFontSize(sticky('a', { fontSize: 42 }))).toBe(42);
  });

  // нуль — валідне число, і ?? має його пропустити, а не підмінити шістнадцяткою
  it('нуль не підмінюється запасом', () => {
    expect(stickyFontSize({ fontSize: 0 })).toBe(0);
  });
});

describe('розмір тексту стікера синхронізується як звичайна властивість', () => {
  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: правка лягає в документ і читається назад`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(sticky('a'));

      useBoardStore.getState().update('a', { fontSize: 28 });

      expect(useBoardStore.getState().getById('a')).toMatchObject({ fontSize: 28 });
      // і справді в документі, а не лише в дзеркалі
      const stored =
        strategy === 'aoi'
          ? cellDocs.objectsOf(['0:0']).find((o) => o.id === 'a')
          : useBoardStore.getState().getById('a');
      expect(stored).toMatchObject({ fontSize: 28 });
    });

    it(`${strategy}: зміна розміру відкочується одним ctrl+z`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(sticky('a'));
      // між створенням і правкою має минути вікно групування, інакше це один крок
      await realWait(PAUSE_MS);

      useBoardStore.getState().update('a', { fontSize: 36 });
      expect(useBoardStore.getState().getById('a')).toMatchObject({ fontSize: 36 });
      const steps = strategy === 'aoi' ? null : boardUndo.undoStack.length;

      undoBoard();

      // повернувся стікер без поля — тобто знову запасний розмір
      expect(stickyFontSize(useBoardStore.getState().getById('a') as StickyObject)).toBe(STICKY_FONT_SIZE);
      if (steps !== null) expect(boardUndo.undoStack.length).toBe(steps - 1);
      else expect(cellUndo.canRedo).toBe(true);
    });
  }
});
