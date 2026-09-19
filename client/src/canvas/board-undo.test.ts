import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StickyObject } from 'shared';
import {
  asAppEdit,
  beginUndoGesture,
  boardDoc,
  boardUndo,
  endUndoGesture,
  resetBoardDoc,
  useBoardStore,
} from './board-store';
import { useEditorStore } from './editor-store';
import { redoBoard, undoBoard } from './board-undo';

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
    createdAt: '2026-09-17T00:00:00.000Z',
    text: '',
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
    ...extra,
  };
}

// та сама позначка, якою useBoardSync кладе чужі оновлення
const REMOTE_ORIGIN = { source: 'network' };

// кінець жесту закривається мікротаскою — тест має дати їй пройти
const settle = () => Promise.resolve();

// yjs дивиться на годинник через захоплене на старті посилання на Date.now
// (lib0/time), тому підмінені таймери vitest на нього не діють — паузу тут
// доводиться вичікувати по-справжньому. 700мс — свідомо більше за вікно
// групування звичайних дій (500мс), інакше тест нічого б не доводив
const PAUSE_MS = 700;
const realWait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// один кадр жесту: так само, як це робить dragmove у фігур
function gestureFrame(id: string, patch: Partial<StickyObject>) {
  const store = useBoardStore.getState();
  store.updateSoon(id, patch);
  store.flushUpdates();
}

function at(id: string) {
  const obj = useBoardStore.getState().getById(id) as StickyObject | undefined;
  return obj && { x: obj.x, y: obj.y };
}

beforeEach(() => {
  resetBoardDoc();
  useEditorStore.getState().selectMany([]);
});

describe('undo/redo поверх Y.UndoManager', () => {
  it('ціле тягання відкочується одним ctrl+z, а не покадрово', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0, y: 0 }));
    const stepsBefore = boardUndo.undoStack.length;

    // секунда тягання — це близько 60 записів у документ, по одному на кадр
    beginUndoGesture();
    for (let i = 1; i <= 60; i++) gestureFrame('a', { x: i * 5, y: i * 3 });
    endUndoGesture();
    await settle();

    expect(at('a')).toEqual({ x: 300, y: 180 });
    // жест додав рівно один крок, а не 60
    expect(boardUndo.undoStack.length - stepsBefore).toBe(1);

    undoBoard();
    expect(at('a')).toEqual({ x: 0, y: 0 });
  });

  it('пауза посеред жесту не ріже його на два кроки', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0, y: 0 }));
    const stepsBefore = boardUndo.undoStack.length;

    beginUndoGesture();
    gestureFrame('a', { x: 50, y: 0 });
    // рука спинилась прицілитись, не відпускаючи кнопки
    await realWait(PAUSE_MS);
    gestureFrame('a', { x: 300, y: 0 });
    endUndoGesture();
    await settle();

    expect(boardUndo.undoStack.length - stepsBefore).toBe(1);
    undoBoard();
    expect(at('a')).toEqual({ x: 0, y: 0 });
  });

  // контроль до попереднього: ті самі два записи з тією самою паузою, але без
  // межі жесту — і ctrl+z кидає обʼєкт на півдорозі. Без цього перший тест міг
  // би проходити просто тому, що кадри йдуть упритул, а не тому, що межі працюють
  it('без межі жесту та сама пауза лишає обʼєкт на півдорозі', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0, y: 0 }));

    gestureFrame('a', { x: 50, y: 0 });
    await realWait(PAUSE_MS);
    gestureFrame('a', { x: 300, y: 0 });

    undoBoard();
    expect(at('a')).toEqual({ x: 50, y: 0 });
  });

  it('два тягання поспіль — два окремі кроки', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0, y: 0 }));

    beginUndoGesture();
    gestureFrame('a', { x: 100, y: 0 });
    endUndoGesture();
    await settle();

    beginUndoGesture();
    gestureFrame('a', { x: 250, y: 0 });
    endUndoGesture();
    await settle();

    undoBoard();
    expect(at('a')).toEqual({ x: 100, y: 0 });
    undoBoard();
    expect(at('a')).toEqual({ x: 0, y: 0 });
  });

  it('ctrl+z не чіпає чужих правок', () => {
    useBoardStore.getState().add(sticky('мій', { x: 0 }));

    const peer = new Y.Doc();
    peer.getMap<StickyObject>('objects').set('чужий', sticky('чужий', { x: 99 }));
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(peer), REMOTE_ORIGIN);
    expect(useBoardStore.getState().getAll()).toHaveLength(2);

    // відкотився лише свій стікер, чужий на місці
    undoBoard();
    expect(useBoardStore.getState().getById('чужий')).toBeTruthy();
    expect(useBoardStore.getState().getById('мій')).toBeUndefined();

    // і стек на цьому порожній — чужу правку відкочувати нема чим
    undoBoard();
    expect(useBoardStore.getState().getById('чужий')).toBeTruthy();
  });

  it('завантажений снепшот не відкочується', () => {
    asAppEdit(() => {
      useBoardStore.getState().add(sticky('s1'));
      useBoardStore.getState().add(sticky('s2'));
    });
    expect(boardUndo.undoStack).toHaveLength(0);

    undoBoard();
    expect(useBoardStore.getState().getAll()).toHaveLength(2);
  });

  it('дії в один такт лягають одним кроком — вставка копій не дає крок на копію', () => {
    const store = useBoardStore.getState();
    const stepsBefore = boardUndo.undoStack.length;
    for (const id of ['c1', 'c2', 'c3']) store.add(sticky(id));

    expect(boardUndo.undoStack.length - stepsBefore).toBe(1);
    undoBoard();
    expect(useBoardStore.getState().getAll()).toHaveLength(0);
  });

  it('ctrl+y повертає скасоване', async () => {
    useBoardStore.getState().add(sticky('a', { x: 0 }));
    // між двома окремими діями людини минає більше за вікно групування
    await realWait(PAUSE_MS);
    useBoardStore.getState().remove('a');
    expect(useBoardStore.getState().getById('a')).toBeUndefined();

    undoBoard();
    expect(useBoardStore.getState().getById('a')).toBeTruthy();
    redoBoard();
    expect(useBoardStore.getState().getById('a')).toBeUndefined();
  });

  it('після відкату виділення не тримається за зниклий обʼєкт', () => {
    useBoardStore.getState().add(sticky('a'));
    useEditorStore.getState().selectMany(['a']);

    undoBoard();
    expect(useBoardStore.getState().getById('a')).toBeUndefined();
    expect(useEditorStore.getState().selectedIds).toEqual([]);
  });

  it('нова дошка починається з порожньою історією', () => {
    useBoardStore.getState().add(sticky('a'));
    expect(boardUndo.undoStack.length).toBeGreaterThan(0);

    resetBoardDoc();
    expect(boardUndo.undoStack).toHaveLength(0);
  });
});

afterEach(() => {
  useEditorStore.getState().selectMany([]);
});
