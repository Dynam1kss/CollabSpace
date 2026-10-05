import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CELL_SIZE } from 'shared';
import type { StickyObject } from 'shared';
import { cellDocs, resetBoardDoc, useBoardStore, useUndoState } from './board-store';
import { beginUndoGesture, endUndoGesture } from './board-store';
import { redoBoard, undoBoard } from './board-undo';
import { CELL_REMOTE } from './cell-docs';
import { setSyncStrategy } from './sync-strategy';
import { useEditorStore } from './editor-store';

function sticky(id: string, extra: Partial<StickyObject> = {}): StickyObject {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex: 0,
    createdBy: 'u1',
    createdAt: '2026-10-05T00:00:00.000Z',
    text: '',
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
    ...extra,
  };
}

// кінець жесту закривається мікротаскою, як і в головному документі
const settle = () => Promise.resolve();

// yjs бере час через захоплене посилання на Date.now, підмінені таймери на
// нього не діють — паузу між двома окремими діями людини вичікуємо по-справжньому
const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gestureFrame(id: string, patch: Partial<StickyObject>) {
  const store = useBoardStore.getState();
  store.updateSoon(id, patch);
  store.flushUpdates();
}

const at = (id: string) => {
  const o = useBoardStore.getState().getById(id) as StickyObject | undefined;
  return o && { x: o.x, y: o.y };
};

beforeEach(() => {
  setSyncStrategy('aoi');
  resetBoardDoc();
  useEditorStore.getState().selectMany([]);
});

afterEach(() => {
  setSyncStrategy('batched');
  resetBoardDoc();
});

describe('undo/redo у стратегії 3 (вміст по клітинках)', () => {
  it('створення відкочується, і кнопки це бачать', () => {
    useBoardStore.getState().add(sticky('a'));
    expect(useUndoState.getState().canUndo).toBe(true);

    undoBoard();
    expect(useBoardStore.getState().getById('a')).toBeUndefined();
    expect(useUndoState.getState().canUndo).toBe(false);
    expect(useUndoState.getState().canRedo).toBe(true);

    redoBoard();
    expect(useBoardStore.getState().getById('a')).toBeTruthy();
  });

  it('ціле тягання — один ctrl+z, а не покадрово', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0, y: 0 }));

    beginUndoGesture();
    for (let i = 1; i <= 60; i++) gestureFrame('a', { x: i * 5, y: i * 3 });
    endUndoGesture();
    await settle();

    expect(at('a')).toEqual({ x: 300, y: 180 });
    undoBoard();
    expect(at('a')).toEqual({ x: 0, y: 0 });
  });

  it('видалення відкочується', async () => {
    useBoardStore.getState().add(sticky('a', { x: 40 }));
    // між двома окремими діями людини минає більше за вікно групування
    await realWait(PAUSE_MS);
    useBoardStore.getState().remove('a');
    expect(useBoardStore.getState().getById('a')).toBeUndefined();

    undoBoard();
    expect(at('a')).toEqual({ x: 40, y: 0 });
  });

  it('переїзд через межу клітинки — теж один крок, а не два', async () => {
    // центр стікера на 1080 — це клітинка 0:0; після жесту на 2580 — 1:0,
    // тобто запис у нову клітинку й видалення зі старої, два документи
    useBoardStore.getState().add(sticky('a', { x: 1000, y: 100 }));
    expect(cellDocs.openCells()).toEqual(['0:0']);

    beginUndoGesture();
    gestureFrame('a', { x: 1500 });
    gestureFrame('a', { x: CELL_SIZE + 500 });
    endUndoGesture();
    await settle();
    expect(cellDocs.openCells()).toContain('1:0');
    expect(at('a')).toEqual({ x: CELL_SIZE + 500, y: 100 });

    // одне натискання має прибрати обидві половини правки, інакше обʼєкт
    // лишився б у двох копіях або зник
    undoBoard();
    expect(at('a')).toEqual({ x: 1000, y: 100 });
    expect(cellDocs.objectsOf(['1:0'])).toHaveLength(0);
    expect(cellDocs.objectsOf(['0:0'])).toHaveLength(1);
  });

  it('ctrl+z не чіпає чужих правок у тій самій клітинці', () => {
    useBoardStore.getState().add(sticky('мій', { x: 10 }));

    const peer = new Y.Doc();
    peer.getMap<StickyObject>('objects').set('чужий', sticky('чужий', { x: 99 }));
    cellDocs.applyRemote('0:0', Y.encodeStateAsUpdate(peer));
    expect(useBoardStore.getState().getAll()).toHaveLength(2);

    undoBoard();
    expect(useBoardStore.getState().getById('чужий')).toBeTruthy();
    expect(useBoardStore.getState().getById('мій')).toBeUndefined();

    // і відкочувати більше нема чого
    undoBoard();
    expect(useBoardStore.getState().getById('чужий')).toBeTruthy();
    expect(useUndoState.getState().canUndo).toBe(false);
  });

  it('засів зі снепшоту не відкочується', () => {
    cellDocs.open('0:0');
    cellDocs.seedFromSnapshot('0:0', [sticky('s1'), sticky('s2')], true);
    expect(useBoardStore.getState().getAll()).toHaveLength(2);
    expect(useUndoState.getState().canUndo).toBe(false);

    undoBoard();
    expect(useBoardStore.getState().getAll()).toHaveLength(2);
  });

  it('клітинку відпустили — її кроки з історії зникають', () => {
    useBoardStore.getState().add(sticky('a'));
    expect(useUndoState.getState().canUndo).toBe(true);

    // пан убік: aoi-sync закриває документ клітинки
    cellDocs.close('0:0');
    expect(useUndoState.getState().canUndo).toBe(false);
  });

  it('дзеркало чистого CELL_REMOTE у стек не лягає', () => {
    cellDocs.open('0:0');
    const peer = new Y.Doc();
    peer.getMap<StickyObject>('objects').set('чужий', sticky('чужий'));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(peer), CELL_REMOTE);
    cellDocs.applyRemote('0:0', Y.encodeStateAsUpdate(peer));

    expect(useBoardStore.getState().getById('чужий')).toBeTruthy();
    expect(useUndoState.getState().canUndo).toBe(false);
  });
});
