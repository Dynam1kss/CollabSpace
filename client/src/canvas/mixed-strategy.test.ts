import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CELL_SIZE, decodeCellKey, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { BoardObject, BoardPoint, CellRect, ConnectorObject } from 'shared';
import { AoiSync } from './aoi-sync';
import { CellDocs } from './cell-docs';

// одна кімната, двоє клієнтів на РІЗНИХ стратегіях — рівно те, що сталось у
// власника: у нього в localStorage лишилось 'aoi' з прогонів стенду, у другого
// пристрою там пусто, і він пішов дефолтним 'batched'. клієнти тут склеєні з
// тих самих частин, що й useBoardSync: batched — один Y.Doc і кадри UPDATE,
// aoi — CellDocs+AoiSync і кадри CELL_*. головний документ є в обох, бо
// useBoardSync створює його завжди

const REMOTE = { source: 'network' };

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
    createdAt: '2026-10-05T10:00:00.000Z',
    text: id,
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
  }) as BoardObject;

const viewAt = (ix: number, iy: number): CellRect => ({
  x: ix * CELL_SIZE + 360,
  y: iy * CELL_SIZE + 600,
  width: 1280,
  height: 800,
});

interface Client {
  id: number;
  // дзеркало стору: його пишуть обидва джерела — головний документ і клітинки
  objects: Map<string, BoardObject>;
  doc: Y.Doc;
  map: Y.Map<BoardObject>;
  docs: CellDocs | null;
  sync: AoiSync | null;
}

function room(snapshotObjects: BoardObject[]) {
  const snapshot = [...snapshotObjects];
  const clients = new Map<number, Client>();
  const cellRooms = new Map<string, number[]>();
  const synced = new Map<number, Set<string>>();
  let queue = Promise.resolve();
  let nextId = 1;

  const deliver = (to: number, frame: Uint8Array) => {
    const copy = frame.slice();
    queue = queue.then(() => {
      const c = clients.get(to);
      if (!c) return;
      if (copy[0] === SYNC_MSG.UPDATE) Y.applyUpdate(c.doc, copy.subarray(1), REMOTE);
      else c.sync?.handle(copy);
    });
  };

  // сервер: UPDATE — усій кімнаті дошки, CELL_* — лише передплатникам клітинки
  const server = (from: Client, frame: Uint8Array) => {
    const type = frame[0];
    if (type === SYNC_MSG.UPDATE) {
      for (const id of clients.keys()) if (id !== from.id) deliver(id, frame);
      return;
    }
    if (type === SYNC_MSG.CELL_SUBSCRIBE) {
      const { add, remove } = JSON.parse(new TextDecoder().decode(frame.subarray(1))) as {
        add: string[];
        remove: string[];
      };
      for (const cell of remove) {
        cellRooms.set(
          cell,
          (cellRooms.get(cell) ?? []).filter((id) => id !== from.id),
        );
        synced.get(from.id)?.delete(cell);
      }
      for (const cell of add)
        cellRooms.set(cell, [...(cellRooms.get(cell) ?? []).filter((id) => id !== from.id), from.id]);
      return;
    }
    if (type === SYNC_MSG.CELL_UPDATE) {
      const key = decodeCellKey(frame, 1)!;
      for (const id of cellRooms.get(key.cell) ?? []) if (id !== from.id) deliver(id, frame);
      return;
    }
    if (type === SYNC_MSG.CELL_SYNC_REQUEST) {
      const key = decodeCellKey(frame, 1)!;
      const roomIds = cellRooms.get(key.cell) ?? [];
      const responder = roomIds.find((id) => id !== from.id && synced.get(id)?.has(key.cell));
      if (responder === undefined) {
        synced.set(from.id, new Set([...(synced.get(from.id) ?? []), key.cell]));
        deliver(from.id, Uint8Array.from([SYNC_MSG.CELL_SYNC_REPLY, ...frame.subarray(1, key.next)]));
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
      const requester = new DataView(frame.buffer, frame.byteOffset).getUint32(1);
      const key = decodeCellKey(frame, 1 + SYNC_REQUESTER_ID_BYTES)!;
      synced.set(requester, new Set([...(synced.get(requester) ?? []), key.cell]));
      deliver(requester, Uint8Array.from([type, ...frame.subarray(1 + SYNC_REQUESTER_ID_BYTES)]));
    }
  };

  function join(strategy: 'batched' | 'aoi') {
    const id = nextId++;
    const objects = new Map<string, BoardObject>();
    const doc = new Y.Doc();
    const map = doc.getMap<BoardObject>('objects');
    const client: Client = { id, objects, doc, map, docs: null, sync: null };
    clients.set(id, client);

    map.observe((event) => {
      for (const key of event.keysChanged) {
        const value = map.get(key);
        if (value === undefined) objects.delete(key);
        else objects.set(key, value);
      }
    });
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      server(client, Uint8Array.from([SYNC_MSG.UPDATE, ...update]));
    });

    if (strategy === 'aoi') {
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
      sync = new AoiSync(docs, {
        send: (frame) => server(client, frame),
        canWrite: () => true,
        fetchSnapshot: async () => snapshot,
        interacting: () => false,
        saveCells: async () => {},
        onStatus: () => {},
      });
      client.docs = docs;
      client.sync = sync;
      sync.start();
    }
    return client;
  }

  async function settle() {
    for (let i = 0; i < 20; i++) {
      await queue;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  return { join, settle };
}

// правка так, як її робить board-store у відповідній стратегії
const edit = (c: Client, id: string, patch: Partial<BoardObject>) => {
  if (c.docs) {
    c.docs.applyPatches(new Map([[id, patch]]));
    return;
  }
  const existing = c.map.get(id);
  if (existing) c.map.set(id, { ...existing, ...patch } as BoardObject);
};

const create = (c: Client, object: BoardObject) => {
  if (c.docs) c.docs.add(object);
  else c.map.set(object.id, object);
};

describe('чому режим мусить бути один на кімнату', () => {
  it('правки власника (aoi) не доходять до другого пристрою (batched)', async () => {
    const r = room([]);
    const owner = r.join('aoi');
    const other = r.join('batched');
    owner.sync!.setView(viewAt(0, 0), true);
    await r.settle();

    create(owner, sticky('власник', 100, 100));
    edit(owner, 'власник', { x: 400 });
    await r.settle();

    // у себе власник усе бачить
    expect(owner.objects.get('власник')!.x).toBe(400);
    // а другий пристрій — нічого: кадри пішли в кімнату клітинки, якої в нього нема
    expect(other.objects.has('власник')).toBe(false);
  });

  it('у зворотний бік доходить — звідси й асиметрія, яку бачив користувач', async () => {
    const r = room([]);
    const owner = r.join('aoi');
    const other = r.join('batched');
    owner.sync!.setView(viewAt(0, 0), true);
    await r.settle();

    create(other, sticky('другий', 100, 100));
    edit(other, 'другий', { x: 700 });
    await r.settle();

    expect(owner.objects.get('другий')!.x).toBe(700);
  });

  it('стрілка другого: власник її бачить, але власні правки по ній нікуди не йдуть', async () => {
    const r = room([]);
    const owner = r.join('aoi');
    const other = r.join('batched');
    owner.sync!.setView(viewAt(0, 0), true);
    await r.settle();

    create(other, sticky('стрілка', 100, 100));
    await r.settle();
    expect(owner.objects.has('стрілка')).toBe(true);

    // власник тягне її — у стратегії 3 запис іде в клітинки, а там цього
    // обʼєкта нема: applyPatches його не знаходить і тихо викидає патч. на
    // екрані кружечки точок уже зсунуті рукою konva, а лінія лишилась на
    // місці — рівно те, що описав користувач
    edit(owner, 'стрілка', { x: 900 });
    await r.settle();
    expect(owner.objects.get('стрілка')!.x).toBe(100);
    expect(other.objects.get('стрілка')!.x).toBe(100);
  });
});

// те саме, що withPoints у connector-geometry; звідти не імпортуємо, бо той
// модуль тягне konva, а вона в node-середовищі просить пакет canvas
const boxOf = (points: BoardPoint[]) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { points, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

const arrow = (id: string, points: BoardPoint[]): BoardObject =>
  ({
    id,
    type: 'connector',
    rotation: 0,
    zIndex: 0,
    createdBy: 'u',
    createdAt: '2026-10-05T10:00:00.000Z',
    strokeColor: '#1f2937',
    strokeWidth: 2,
    arrowEnd: true,
    ...boxOf(points),
  }) as BoardObject;

const shift = (points: BoardPoint[], dx: number) => points.map((p) => ({ x: p.x + dx, y: p.y }));

// рамка обʼєкта має йти за точками: по x/y/width/height малюється все, крім
// самої кривої, і якщо вони розійдуться — ручки точок поїдуть окремо від лінії
function consistent(c: Client, id: string) {
  const o = c.objects.get(id) as ConnectorObject | undefined;
  if (!o) return null;
  const box = boxOf(o.points);
  expect({ x: o.x, y: o.y, width: o.width, height: o.height }).toEqual({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  });
  return o.points.map((p) => p.x).join(',');
}

describe('стрілка в кімнаті з одним режимом', () => {
  for (const strategy of ['batched', 'aoi'] as const) {
    it(`${strategy}: двоє по черзі рухають ту саму стрілку — точки й лінія сходяться`, async () => {
      const r = room([]);
      const a = r.join(strategy);
      const b = r.join(strategy);
      a.sync?.setView(viewAt(0, 0), true);
      b.sync?.setView(viewAt(0, 0), true);
      await r.settle();

      create(
        a,
        arrow('стрілка', [
          { x: 100, y: 100 },
          { x: 300, y: 200 },
        ]),
      );
      await r.settle();
      expect(consistent(b, 'стрілка')).toBe('100,300');

      // по черзі: кожен бере свіжі точки з того, що в нього вже є
      for (const [who, other, dx] of [
        [a, b, 50],
        [b, a, 70],
        [a, b, -30],
      ] as const) {
        const points = (who.objects.get('стрілка') as ConnectorObject).points;
        edit(who, 'стрілка', boxOf(shift(points, dx)));
        await r.settle();
        expect(consistent(who, 'стрілка')).toBe(consistent(other, 'стрілка'));
      }

      expect(consistent(a, 'стрілка')).toBe('190,390');
    });
  }
});
