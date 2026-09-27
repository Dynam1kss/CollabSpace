import { describe, expect, it } from 'vitest';
import { CELL_SIZE, decodeCellKey, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { BoardObject, CellRect } from 'shared';
import { AoiSync } from './aoi-sync';
import { CellDocs } from './cell-docs';

// стенд протоколу стратегії 3: кілька клієнтів (CellDocs + AoiSync) і сервер,
// що повторює правила board-rooms.ts для клітинок. Кадри доставляються по
// черзі асинхронно — як сокет: порядок від одного відправника зберігається

const sticky = (id: string, x: number, y: number): BoardObject =>
  ({
    id,
    type: 'sticky',
    x,
    y,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex: 0,
    createdBy: 'u',
    createdAt: '2026-09-27T10:00:00.000Z',
    text: id,
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
  }) as BoardObject;

// видиме вікно 1280×800 посеред клітинки (ix, iy) — передплата не вилазить у сусідні далекі
const viewAt = (ix: number, iy: number): CellRect => ({
  x: ix * CELL_SIZE + 360,
  y: iy * CELL_SIZE + 600,
  width: 1280,
  height: 800,
});

interface Client {
  id: number;
  role: 'EDITOR' | 'VIEWER';
  docs: CellDocs;
  sync: AoiSync;
  objects: Map<string, BoardObject>;
  // скільки кадрів вмісту клітинок прийшло цьому клієнту (для «нуль трафіку»)
  cellFramesIn: number;
  interacting: boolean;
}

function world(snapshotObjects: BoardObject[]) {
  let snapshot = [...snapshotObjects];
  const clients = new Map<number, Client>();
  const rooms = new Map<string, number[]>();
  const synced = new Map<number, Set<string>>();
  let queue = Promise.resolve();
  let nextId = 1;

  const deliver = (to: number, frame: Uint8Array) => {
    const copy = frame.slice();
    queue = queue.then(() => {
      const c = clients.get(to);
      if (!c) return;
      if (copy[0] >= SYNC_MSG.CELL_UPDATE) c.cellFramesIn++;
      c.sync.handle(copy);
    });
  };

  const server = (from: Client, frame: Uint8Array) => {
    const type = frame[0];
    if (type === SYNC_MSG.CELL_SUBSCRIBE) {
      const { add, remove } = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as {
        add: string[];
        remove: string[];
      };
      for (const cell of remove) {
        rooms.set(
          cell,
          (rooms.get(cell) ?? []).filter((id) => id !== from.id),
        );
        synced.get(from.id)?.delete(cell);
      }
      for (const cell of add)
        rooms.set(cell, [...(rooms.get(cell) ?? []).filter((id) => id !== from.id), from.id]);
      return;
    }
    if (type === SYNC_MSG.CELL_UPDATE) {
      if (from.role === 'VIEWER') return;
      const key = decodeCellKey(frame, 1)!;
      for (const id of rooms.get(key.cell) ?? []) if (id !== from.id) deliver(id, frame);
      return;
    }
    if (type === SYNC_MSG.CELL_SYNC_REQUEST) {
      const key = decodeCellKey(frame, 1)!;
      const room = rooms.get(key.cell) ?? [];
      const responder = room.find(
        (id) => id !== from.id && clients.get(id)!.role !== 'VIEWER' && synced.get(id)?.has(key.cell),
      );
      if (responder === undefined) {
        synced.set(from.id, new Set([...(synced.get(from.id) ?? []), key.cell]));
        deliver(from.id, Uint8Array.from([SYNC_MSG.CELL_SYNC_REPLY, ...frame.subarray(1, key.next)]));
        if (from.role !== 'VIEWER') {
          for (const id of room) {
            if (id !== from.id && clients.get(id)!.role === 'VIEWER') {
              deliver(id, Uint8Array.from([SYNC_MSG.CELL_RESET, ...frame.subarray(1, key.next)]));
            }
          }
        }
        return;
      }
      const withId = new Uint8Array(frame.length + SYNC_REQUESTER_ID_BYTES);
      withId[0] = type;
      new DataView(withId.buffer).setUint32(1, from.id);
      withId.set(frame.subarray(1), 1 + SYNC_REQUESTER_ID_BYTES);
      deliver(responder, withId);
      return;
    }
    if (type === SYNC_MSG.CELL_SYNC_REPLY) {
      if (from.role === 'VIEWER') return;
      const requester = new DataView(frame.buffer, frame.byteOffset).getUint32(1);
      const key = decodeCellKey(frame, 1 + SYNC_REQUESTER_ID_BYTES)!;
      synced.set(requester, new Set([...(synced.get(requester) ?? []), key.cell]));
      deliver(requester, Uint8Array.from([type, ...frame.subarray(1 + SYNC_REQUESTER_ID_BYTES)]));
    }
  };

  function join(role: 'EDITOR' | 'VIEWER' = 'EDITOR') {
    const id = nextId++;
    const objects = new Map<string, BoardObject>();
    // eslint-disable-next-line prefer-const
    let sync: AoiSync;
    const docs = new CellDocs({
      onMirror: (changes) => {
        for (const [k, v] of changes) {
          if (v) objects.set(k, v);
          else objects.delete(k);
        }
      },
      onLocalUpdate: (cell, update) => sync.localUpdate(cell, update),
      onNeedCell: (cell) => sync.needCell(cell),
    });
    const client: Client = {
      id,
      role,
      docs,
      sync: null as unknown as AoiSync,
      objects,
      cellFramesIn: 0,
      interacting: false,
    };
    sync = new AoiSync(docs, {
      send: (frame) => server(client, frame),
      canWrite: () => client.role !== 'VIEWER',
      fetchSnapshot: async () => snapshot,
      interacting: () => client.interacting,
      saveCells: async (cells, objs) => {
        const mine = new Set(cells);
        const cellOf = (o: BoardObject) =>
          `${Math.floor((o.x + o.width / 2) / CELL_SIZE)}:${Math.floor((o.y + o.height / 2) / CELL_SIZE)}`;
        snapshot = [
          ...snapshot.filter((o) => !mine.has(cellOf(o))),
          ...objs.filter((o) => mine.has(cellOf(o))),
        ];
      },
      onStatus: () => {},
    });
    client.sync = sync;
    clients.set(id, client);
    sync.start();
    return client;
  }

  // дочекатись, поки мережа затихне (кадри породжують нові кадри)
  async function settle() {
    for (let i = 0; i < 20; i++) {
      await queue;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { join, settle, snapshot: () => snapshot };
}

// правка клієнта через його документ — те, що зробив би board-store
const move = (c: Client, id: string, x: number, y: number) => c.docs.applyPatches(new Map([[id, { x, y }]]));

describe('стратегія 3: передплата на клітинки', () => {
  it('правка в області A не доходить до того, хто бачить лише B, але доходить до третього в A', async () => {
    const w = world([sticky('a', 100, 100), sticky('b', 5 * CELL_SIZE + 100, 5 * CELL_SIZE + 100)]);
    const A = w.join();
    const B = w.join();
    const C = w.join();
    A.sync.setView(viewAt(0, 0), true);
    B.sync.setView(viewAt(5, 5), true);
    C.sync.setView(viewAt(0, 0), true);
    await w.settle();
    expect([...A.objects.keys()]).toEqual(['a']);
    expect([...B.objects.keys()]).toEqual(['b']);
    expect([...C.objects.keys()]).toEqual(['a']);

    const bBefore = B.cellFramesIn;
    for (let i = 1; i <= 10; i++) move(A, 'a', 100 + i * 10, 100);
    await w.settle();
    expect(C.objects.get('a')!.x).toBe(200);
    // до B не прийшло нічого — ні кадру
    expect(B.cellFramesIn).toBe(bBefore);
    expect(B.objects.has('a')).toBe(false);
  });

  it('пан A→B: наздоганяє B через sync клітинки, а після виходу з A правки A вже не приходять', async () => {
    const w = world([sticky('a', 100, 100), sticky('b', 5 * CELL_SIZE + 100, 5 * CELL_SIZE + 100)]);
    const A = w.join();
    const B = w.join();
    A.sync.setView(viewAt(5, 5), true);
    B.sync.setView(viewAt(0, 0), true);
    await w.settle();
    // A правив b, поки B дивився в 0:0 — у снепшоті цього ще нема
    move(A, 'b', 5 * CELL_SIZE + 700, 5 * CELL_SIZE + 100);
    await w.settle();
    expect(B.objects.has('b')).toBe(false);

    B.sync.setView(viewAt(5, 5), true);
    await w.settle();
    // живий стан від A, а не снепшот
    expect(B.objects.get('b')!.x).toBe(5 * CELL_SIZE + 700);
    expect(B.objects.has('a')).toBe(false);

    B.sync.setView(viewAt(0, 0), true);
    await w.settle();
    const before = B.cellFramesIn;
    move(A, 'b', 5 * CELL_SIZE + 900, 5 * CELL_SIZE + 100);
    await w.settle();
    expect(B.cellFramesIn).toBe(before);
    expect(B.objects.has('b')).toBe(false);
    expect(B.objects.get('a')!.x).toBe(100);
  });

  it('двоє редакторів одночасно заходять у клітинку, де живих нема: обидва бачать вміст зі снепшоту, не порожнечу', async () => {
    const w = world([sticky('a', 100, 100), sticky('a2', 600, 300)]);
    const A = w.join();
    const B = w.join();
    A.sync.setView(viewAt(0, 0), true);
    B.sync.setView(viewAt(0, 0), true);
    await w.settle();
    expect([...A.objects.keys()].sort()).toEqual(['a', 'a2']);
    expect([...B.objects.keys()].sort()).toEqual(['a', 'a2']);
    // і правка одного доходить до іншого — історії цілі
    move(B, 'a', 300, 300);
    await w.settle();
    expect(A.objects.get('a')!.x).toBe(300);
    expect(A.docs.encodeState('0:0').length).toBeGreaterThan(0);
  });

  it('обʼєкт переїжджає в сусідню клітинку: у того, хто бачить обидві, — рівно одна копія весь час', async () => {
    const w = world([sticky('a', CELL_SIZE - 400, 100)]);
    const A = w.join();
    const C = w.join();
    // вікно на межі 0:0 і 1:0 — передплата на обидві
    const edge = { x: CELL_SIZE - 640, y: 400, width: 1280, height: 800 };
    A.sync.setView(edge, true);
    C.sync.setView(edge, true);
    await w.settle();
    for (let x = CELL_SIZE - 400; x <= CELL_SIZE + 300; x += 100) {
      move(A, 'a', x, 100);
      await w.settle();
      expect(C.objects.has('a')).toBe(true);
    }
    expect(C.objects.get('a')!.x).toBe(CELL_SIZE + 300);
    // лежить лише в 1:0
    expect(C.docs.objectsOf(['0:0']).map((o) => o.id)).toEqual([]);
    expect(C.docs.objectsOf(['1:0']).map((o) => o.id)).toEqual(['a']);
  });

  it('посеред жесту передплату не знімає; по кінцю жесту — знімає', async () => {
    const w = world([sticky('a', 100, 100)]);
    const A = w.join();
    const C = w.join();
    A.sync.setView(viewAt(0, 0), true);
    C.sync.setView(viewAt(0, 0), true);
    await w.settle();
    A.interacting = true;
    A.sync.setView(viewAt(8, 8), true);
    move(A, 'a', 400, 100);
    await w.settle();
    // кадр жесту дійшов — клітинка ще передплачена
    expect(C.objects.get('a')!.x).toBe(400);
    A.interacting = false;
    A.sync.gestureEnded();
    await w.settle();
    expect(A.objects.has('a')).toBe(false);
    // незбережене перед відпусканням лягло в снепшот
    expect(w.snapshot().find((o) => o.id === 'a')!.x).toBe(400);
  });

  it('глядач: без редакторів — снепшот у дзеркало; прийшов редактор — CELL_RESET і живий стан', async () => {
    const w = world([sticky('a', 100, 100)]);
    const V = w.join('VIEWER');
    V.sync.setView(viewAt(0, 0), true);
    await w.settle();
    expect(V.objects.get('a')!.x).toBe(100);
    // глядач не пише в документ
    expect(V.docs.hasHistory('0:0')).toBe(false);

    const A = w.join();
    A.sync.setView(viewAt(0, 0), true);
    await w.settle();
    move(A, 'a', 500, 100);
    await w.settle();
    expect(V.objects.get('a')!.x).toBe(500);
  });
});
