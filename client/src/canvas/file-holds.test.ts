import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CELL_SIZE, cellKey } from 'shared';
import type { BoardObject, FileObject } from 'shared';
import { boardDoc, cellDocs, REMOTE_ORIGIN, resetBoardDoc, useBoardStore } from './board-store';
import { clearFileHolds, holdUploadedFile, useFileHolds, watchFileHolds } from './file-holds';
import { setSyncStrategy } from './sync-strategy';

// Резерв місця під файл має належати ТОМУ, ХТО ВИДАЛИВ. Доти його брав кожен,
// хто просто побачив, що картка зникла, — а в стратегії 3 «зникла» означало ще
// й «я відвів вікно, і клітинка згорнулась». Через це місце тримав будь-хто,
// хто сидів на дошці, і звільнялось воно лише коли дошку покидали всі

const fileCard = (id: string, fileId: string, x = 0, y = 0): BoardObject =>
  ({
    id,
    type: 'file',
    x,
    y,
    width: 240,
    height: 76,
    rotation: 0,
    zIndex: 0,
    createdBy: 'u',
    createdAt: '2026-10-07T00:00:00.000Z',
    fileId,
    name: 'a.bin',
    size: 1024,
    mime: 'application/octet-stream',
  }) as FileObject as BoardObject;

const held = () => [...useFileHolds.getState().held];

// чуже видалення: інший клієнт того самого документа прибирає обʼєкт, і до нас
// приїжджає готове оновлення
function remoteRemoveFromCell(cell: string, id: string) {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, cellDocs.encodeState(cell));
  const before = Y.encodeStateVector(peer);
  peer.getMap<BoardObject>('objects').delete(id);
  cellDocs.applyRemote(cell, Y.encodeStateAsUpdate(peer, before));
}

function remoteRemoveFromBoard(id: string) {
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(boardDoc));
  const before = Y.encodeStateVector(peer);
  peer.getMap<BoardObject>('objects').delete(id);
  Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(peer, before), REMOTE_ORIGIN);
}

describe('резерв місця бере той, хто видалив', () => {
  beforeEach(() => {
    cellDocs.closeAll();
    resetBoardDoc();
    clearFileHolds();
  });

  it('стратегія 3: моє видалення — беру на себе, чуже — ні', () => {
    setSyncStrategy('aoi');
    const stop = watchFileHolds();
    useBoardStore.getState().add(fileCard('c1', 'f1'));
    useBoardStore.getState().add(fileCard('c2', 'f2'));
    expect(held()).toEqual([]);

    useBoardStore.getState().remove('c1');
    expect(held()).toEqual(['f1']);

    // те саме видалення, але прийшло з мережі — місце тримає той, хто його
    // зробив, а не я
    remoteRemoveFromCell(cellKey(0, 0), 'c2');
    expect(useBoardStore.getState().objects.c2).toBeUndefined();
    expect(held()).toEqual(['f1']);
    stop();
  });

  it('стратегія 3: відвів вікно — клітинка згорнулась, але це не видалення', () => {
    setSyncStrategy('aoi');
    const stop = watchFileHolds();
    const far = fileCard('c3', 'f3', 2 * CELL_SIZE + 10, 10);
    useBoardStore.getState().add(far);
    expect(held()).toEqual([]);

    cellDocs.close(cellKey(2, 0));
    expect(useBoardStore.getState().objects.c3).toBeUndefined();
    expect(held()).toEqual([]);
    stop();
  });

  it('стратегії 1/2: так само — своє видалення моє, чуже чуже', () => {
    setSyncStrategy('batched');
    const stop = watchFileHolds();
    useBoardStore.getState().add(fileCard('c1', 'f1'));
    useBoardStore.getState().add(fileCard('c2', 'f2'));

    useBoardStore.getState().remove('c1');
    expect(held()).toEqual(['f1']);

    remoteRemoveFromBoard('c2');
    expect(useBoardStore.getState().objects.c2).toBeUndefined();
    expect(held()).toEqual(['f1']);
    stop();
  });

  it('картка повернулась — резерв відпущено', () => {
    setSyncStrategy('aoi');
    const stop = watchFileHolds();
    useBoardStore.getState().add(fileCard('c1', 'f1'));
    useBoardStore.getState().remove('c1');
    expect(held()).toEqual(['f1']);

    // ctrl+z, або хтось інший повернув ту саму картку
    useBoardStore.getState().add(fileCard('c1', 'f1'));
    expect(held()).toEqual([]);
    stop();
  });

  it('резерв завантаження тримається до картки й знімається нею', () => {
    setSyncStrategy('aoi');
    const stop = watchFileHolds();
    holdUploadedFile('f9');
    expect(held()).toEqual(['f9']);

    useBoardStore.getState().add(fileCard('c9', 'f9'));
    expect(held()).toEqual([]);
    stop();
  });
});
