import { afterEach, describe, expect, it } from 'vitest';
import { CELL_SIZE, linkKind, linkVideoId } from 'shared';
import type { LinkObject } from 'shared';
import { boardUndo, cellDocs, cellUndo, resetBoardDoc, useBoardStore } from './board-store';
import { undoBoard, redoBoard } from './board-undo';
import { setSyncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

// картка посилання — такий самий обʼєкт дошки, як решта (06.10): перевіряємо,
// що вона синхронізується обома стратегіями, відкочується і переїжджає між
// клітинками. Малювання тут не чіпаємо — konva в юніт-тестах не піднімається

const link = (id: string, x: number, y: number, url = 'https://example.com/a'): LinkObject => ({
  id,
  type: 'link',
  x,
  y,
  width: 260,
  height: 84,
  rotation: 0,
  zIndex: 0,
  createdBy: 'u1',
  createdAt: '2026-10-06T00:00:00.000Z',
  url,
  kind: 'web',
});

const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const get = (id: string) => useBoardStore.getState().getById(id) as LinkObject | undefined;

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('картка посилання як звичайний обʼєкт дошки', () => {
  for (const strategy of ['batched', 'aoi'] as SyncStrategy[]) {
    it(`${strategy}: створення й правка підпису лягають у документ`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(link('k', 100, 100));

      useBoardStore.getState().update('k', { title: 'Приклад' });

      const stored = strategy === 'aoi' ? cellDocs.objectsOf(['0:0']).find((o) => o.id === 'k') : get('k');
      expect(stored).toMatchObject({ type: 'link', url: 'https://example.com/a', title: 'Приклад' });
    });

    it(`${strategy}: зміна адреси міняє й різновид картки`, () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(link('k', 0, 0));
      expect(linkKind(get('k')!)).toBe('web');

      useBoardStore
        .getState()
        .update('k', { url: 'https://youtu.be/dQw4w9WgXcQ', kind: 'youtube', videoId: 'dQw4w9WgXcQ' });

      expect(linkKind(get('k')!)).toBe('youtube');
      expect(linkVideoId(get('k')!)).toBe('dQw4w9WgXcQ');
    });

    it(`${strategy}: підпис відкочується одним ctrl+z, ctrl+y вертає`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(link('k', 0, 0));
      await realWait(PAUSE_MS);

      useBoardStore.getState().update('k', { title: 'Підпис' });
      expect(get('k')).toMatchObject({ title: 'Підпис' });
      const steps = strategy === 'aoi' ? null : boardUndo.undoStack.length;

      undoBoard();
      expect(get('k')?.title).toBeUndefined();
      if (steps !== null) expect(boardUndo.undoStack.length).toBe(steps - 1);
      else expect(cellUndo.canRedo).toBe(true);

      redoBoard();
      expect(get('k')).toMatchObject({ title: 'Підпис' });
    });

    it(`${strategy}: видалення й відкат видалення`, async () => {
      setSyncStrategy(strategy);
      resetBoardDoc();
      useBoardStore.getState().add(link('k', 10, 20));
      await realWait(PAUSE_MS);

      useBoardStore.getState().remove('k');
      expect(get('k')).toBeUndefined();

      undoBoard();
      expect(get('k')).toMatchObject({ url: 'https://example.com/a', x: 10, y: 20 });
    });
  }

  it('стратегія 3: картка переїжджає в сусідню клітинку, і це один крок undo', async () => {
    setSyncStrategy('aoi');
    resetBoardDoc();
    // центр (130,42) — клітинка 0:0
    useBoardStore.getState().add(link('k', 0, 0));
    expect(cellDocs.openCells()).toEqual(['0:0']);
    await realWait(PAUSE_MS);

    useBoardStore.getState().update('k', { x: CELL_SIZE, y: 0 });
    expect(cellDocs.openCells()).toContain('1:0');
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(0);

    undoBoard();
    expect(get('k')).toMatchObject({ x: 0 });
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(1);
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(0);
  });

  it('z-порядок і замок — ті самі поля, що в решти типів', () => {
    resetBoardDoc();
    useBoardStore.getState().add(link('k', 0, 0));
    useBoardStore.getState().update('k', { zIndex: 7, locked: true });
    expect(get('k')).toMatchObject({ zIndex: 7, locked: true });
  });
});
