import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StickyObject } from 'shared';
import {
  asAppEdit,
  boardDoc,
  boardUndo,
  clearUndoHistory,
  replaceBoardContent,
  resetBoardDoc,
  useBoardStore,
} from './board-store';

function sticky(id: string, text = ''): StickyObject {
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
    createdAt: '2026-09-26T00:00:00.000Z',
    text,
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
  };
}

describe('заміна вмісту при відкаті', () => {
  beforeEach(() => {
    resetBoardDoc();
  });

  it('документ стає рівно таким, як версія: зайве зникає, нове зʼявляється, змінене переписується', () => {
    asAppEdit(() => {
      for (const o of [sticky('a', 'було'), sticky('b'), sticky('gone')]) useBoardStore.getState().add(o);
    });
    replaceBoardContent([sticky('a', 'з версії'), sticky('b'), sticky('new')]);
    const objects = useBoardStore.getState().objects;
    expect(Object.keys(objects).sort()).toEqual(['a', 'b', 'new']);
    expect(objects.a.type === 'sticky' && objects.a.text).toBe('з версії');
  });

  it('незмінені обʼєкти не переписуються — той самий вміст не дає жодного оновлення в мережу', () => {
    asAppEdit(() => {
      for (const o of [sticky('a'), sticky('b')]) useBoardStore.getState().add(o);
    });
    let updates = 0;
    boardDoc.on('update', () => updates++);
    replaceBoardContent([sticky('a'), sticky('b')]);
    expect(updates).toBe(0);
  });

  it('відкат не потрапляє в undo, а старі кроки після нього чистяться', () => {
    useBoardStore.getState().add(sticky('a', 'моя правка'));
    expect(boardUndo.undoStack.length).toBe(1);
    replaceBoardContent([sticky('a', 'з версії')]);
    // сам відкат — правка застосунку, стек він не росте
    expect(boardUndo.undoStack.length).toBe(1);
    clearUndoHistory();
    expect(boardUndo.undoStack.length).toBe(0);
  });
});

// чому відкат записує в документ ОДИН клієнт, а не кожен. Модель: редактор і
// глядач, чиї записи сервер нікуди не ретранслює
describe('хто пише відкат у документ', () => {
  function pair(editorId: number, viewerId: number) {
    const editor = new Y.Doc();
    editor.clientID = editorId;
    const viewer = new Y.Doc();
    viewer.clientID = viewerId;
    // від редактора до глядача — усе; назад — нічого, як на сервері
    editor.on('update', (u: Uint8Array) => Y.applyUpdate(viewer, u, 'net'));
    editor.getMap('objects').set('a', { text: 'початок' });
    return { editor, viewer, text: (d: Y.Doc) => (d.getMap('objects').get('a') as { text: string }).text };
  }

  it('пишуть обидва — глядач із більшим clientID застигає на своєму записі', () => {
    const { editor, viewer, text } = pair(1, 2);
    viewer.getMap('objects').set('a', { text: 'з версії' });
    editor.getMap('objects').set('a', { text: 'з версії' });
    // далі редактор править — глядач цього вже не бачить
    editor.getMap('objects').set('a', { text: 'правка після відкату' });
    expect(text(editor)).toBe('правка після відкату');
    expect(text(viewer)).toBe('з версії');
  });

  it('пише лише один — глядач іде за ним і далі', () => {
    const { editor, viewer, text } = pair(1, 2);
    editor.getMap('objects').set('a', { text: 'з версії' });
    expect(text(viewer)).toBe('з версії');
    editor.getMap('objects').set('a', { text: 'правка після відкату' });
    expect(text(viewer)).toBe('правка після відкату');
  });
});
