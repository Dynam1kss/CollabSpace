import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StickyObject } from 'shared';
import {
  boardDoc,
  docHasHistory,
  materializeMirror,
  rebuildMirrorFromDoc,
  resetBoardDoc,
  seedMirror,
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
    createdAt: '2026-09-27T00:00:00.000Z',
    text,
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
  };
}

const REMOTE = { source: 'network' };

// документ редактора, чию історію глядач приймає як є
function editorDoc(objects: StickyObject[]) {
  const doc = new Y.Doc();
  for (const o of objects) doc.getMap('objects').set(o.id, o);
  return doc;
}

describe('глядач: дзеркало без записів у документ', () => {
  beforeEach(() => {
    resetBoardDoc();
  });

  it('снепшот з rest лягає лише в дзеркало — документ порожній і нічого не шле', () => {
    let updates = 0;
    boardDoc.on('update', () => updates++);
    seedMirror([sticky('a'), sticky('b')]);
    expect(Object.keys(useBoardStore.getState().objects).sort()).toEqual(['a', 'b']);
    expect(boardDoc.getMap('objects').size).toBe(0);
    expect(docHasHistory()).toBe(false);
    expect(updates).toBe(0);
  });

  it('прийшла історія редактора — дзеркало з документа, зайве з rest зникає', () => {
    seedMirror([sticky('a', 'з rest'), sticky('ghost')]);
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(editorDoc([sticky('a', 'від редактора')])), REMOTE);
    expect(docHasHistory()).toBe(true);
    rebuildMirrorFromDoc();
    const objects = useBoardStore.getState().objects;
    expect(Object.keys(objects)).toEqual(['a']);
    expect(objects.a.type === 'sticky' && objects.a.text).toBe('від редактора');
  });

  it('далі правки й видалення редактора доходять, бо в глядача немає своїх записів тих ключів', () => {
    const editor = editorDoc([sticky('a', 'було'), sticky('b')]);
    // глядачеві з більшим clientID раніше саме тут лишався свій варіант
    boardDoc.clientID = editor.clientID + 1;
    seedMirror([sticky('a', 'було'), sticky('b')]);
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(editor), REMOTE);
    rebuildMirrorFromDoc();
    editor.on('update', (u: Uint8Array) => Y.applyUpdate(boardDoc, u, REMOTE));
    editor.getMap('objects').set('a', sticky('a', 'правка'));
    editor.getMap('objects').delete('b');
    const objects = useBoardStore.getState().objects;
    expect(Object.keys(objects)).toEqual(['a']);
    expect(objects.a.type === 'sticky' && objects.a.text).toBe('правка');
  });

  it('новий документ посеред сеансу не стирає того, що на екрані', () => {
    seedMirror([sticky('a')]);
    resetBoardDoc(true);
    expect(Object.keys(useBoardStore.getState().objects)).toEqual(['a']);
    resetBoardDoc();
    expect(useBoardStore.getState().objects).toEqual({});
  });

  it('підняли до редактора — у документ дописується лише те, чого там нема', () => {
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(editorDoc([sticky('a', 'з документа')])), REMOTE);
    rebuildMirrorFromDoc();
    seedMirror([
      ...(Object.values(useBoardStore.getState().objects) as StickyObject[]),
      sticky('only-mirror'),
    ]);
    materializeMirror();
    const map = boardDoc.getMap<StickyObject>('objects');
    expect([...map.keys()].sort()).toEqual(['a', 'only-mirror']);
    expect(map.get('a')?.text).toBe('з документа');
  });
});
