import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardObject, StickyObject } from 'shared';
import { boardDoc, useBoardStore } from './board-store';

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

// клієнт у тесті — просто ще один Y.Doc з тією самою мапою, що й у сторі.
// clientID задається явно там, де від його порядку залежить, чий запис виграє
function client(clientID?: number) {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  return { doc, objects: doc.getMap<BoardObject>('objects') };
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('board-store поверх Y.Map', () => {
  beforeEach(() => {
    const store = useBoardStore.getState();
    store.removeMany(store.getAll().map((o) => o.id));
  });

  it('add/update/remove проходять через Y.Map і видно в дзеркалі', () => {
    const store = useBoardStore.getState();
    store.add(sticky('a'));
    expect((useBoardStore.getState().getById('a') as StickyObject).text).toBe('');
    expect(boardDoc.getMap('objects').has('a')).toBe(true);

    store.update('a', { text: 'привіт', x: 10 });
    expect(useBoardStore.getState().getById('a')).toMatchObject({ text: 'привіт', x: 10, width: 160 });
    // патч на неіснуючий — нічого
    store.update('zzz', { x: 1 });
    expect(useBoardStore.getState().getAll()).toHaveLength(1);

    store.remove('a');
    expect(useBoardStore.getState().getAll()).toHaveLength(0);
  });

  it('removeMany — одна транзакція, одне оновлення дзеркала', () => {
    const store = useBoardStore.getState();
    store.add(sticky('a'));
    store.add(sticky('b'));
    store.add(sticky('c'));
    let updates = 0;
    const unsub = useBoardStore.subscribe(() => updates++);
    store.removeMany(['a', 'b', 'c']);
    unsub();
    expect(updates).toBe(1);
    expect(useBoardStore.getState().getAll()).toHaveLength(0);
  });

  it('два клієнти, ті самі зміни в різному порядку — однаковий стан', () => {
    const a = client();
    const b = client();
    a.objects.set('s1', sticky('s1', { text: 'один' }));
    a.objects.set('s2', sticky('s2', { text: 'два' }));
    b.objects.set('s2', sticky('s2', { text: 'два' }));
    b.objects.set('s1', sticky('s1', { text: 'один' }));

    sync(a.doc, b.doc);
    expect(a.objects.toJSON()).toEqual(b.objects.toJSON());
    expect(Object.keys(a.objects.toJSON()).sort()).toEqual(['s1', 's2']);
  });

  it('паралельні правки різних обʼєктів зливаються без втрат', () => {
    const a = client();
    const b = client();
    a.objects.set('s1', sticky('s1'));
    a.objects.set('s2', sticky('s2'));
    sync(a.doc, b.doc);

    // офлайн: а рухає s1, b пише в s2, обидва не бачать одне одного
    a.objects.set('s1', { ...(a.objects.get('s1') as StickyObject), x: 100 });
    b.objects.set('s2', { ...(b.objects.get('s2') as StickyObject), text: 'з іншого' });
    b.objects.delete('s1'); // а ще b видалив те, що a щойно посунув

    sync(a.doc, b.doc);
    expect(a.objects.toJSON()).toEqual(b.objects.toJSON());
    expect(a.objects.get('s2')).toMatchObject({ text: 'з іншого' });
    // конфлікт «посунув vs видалив» — обидва зійшлись на одному й тому ж
    expect(a.objects.has('s1')).toBe(b.objects.has('s1'));
  });

  it('одночасна правка того самого обʼєкта — збіжність до одного значення', () => {
    const a = client();
    const b = client();
    a.objects.set('s1', sticky('s1'));
    sync(a.doc, b.doc);
    a.objects.set('s1', sticky('s1', { text: 'від a' }));
    b.objects.set('s1', sticky('s1', { text: 'від b' }));
    // порядок застосування не має значення — результат той самий
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    expect(a.objects.get('s1')).toEqual(b.objects.get('s1'));
    expect(['від a', 'від b']).toContain((a.objects.get('s1') as StickyObject).text);
  });

  // це той самий баг, що зʼїв обʼєкти з бази 18.09: B зайшла, не отримала
  // історію A (sync-запит пішов мертвому сокету) і підняла ті самі обʼєкти зі
  // снепшоту як власні. Далі дельта A приносить delete на запис B — його
  // застосувати можна одразу, а заміну ні (прогалина в клоках A), і обʼєкт
  // зникає в B назовсім. Тест тримає причину, а не симптом
  it('дельта від клієнта, чиєї історії нема, зʼїдає обʼєкт', () => {
    // clientID A менший — тоді у A виграє запис B, і саме його дельта A видалить
    const a = client(100);
    const b = client(200);
    a.objects.set('s1', sticky('s1'));
    a.objects.set('s2', sticky('s2'));

    const fromB: Uint8Array[] = [];
    b.doc.on('update', (u: Uint8Array) => fromB.push(u));
    // B без sync-відповіді: ті самі обʼєкти зі снепшоту, але як власні add
    b.objects.set('s1', sticky('s1'));
    b.objects.set('s2', sticky('s2'));
    for (const u of fromB) Y.applyUpdate(a.doc, u);

    const fromA: Uint8Array[] = [];
    a.doc.on('update', (u: Uint8Array) => fromA.push(u));
    a.objects.set('s1', { ...(a.objects.get('s1') as StickyObject), x: 999 });
    for (const u of fromA) Y.applyUpdate(b.doc, u);

    expect(Object.keys(a.objects.toJSON()).sort()).toEqual(['s1', 's2']);
    expect(b.objects.has('s1')).toBe(false);
  });

  it('з історією A та сама дельта нічого не зʼїдає', () => {
    const a = client(100);
    const b = client(200);
    a.objects.set('s1', sticky('s1'));
    a.objects.set('s2', sticky('s2'));
    // sync-відповідь, якої в баговому сценарії не було
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    b.objects.set('s1', sticky('s1'));
    b.objects.set('s2', sticky('s2'));

    const fromA: Uint8Array[] = [];
    a.doc.on('update', (u: Uint8Array) => fromA.push(u));
    a.objects.set('s1', { ...(a.objects.get('s1') as StickyObject), x: 999 });
    for (const u of fromA) Y.applyUpdate(b.doc, u);

    // обидва обʼєкти на місці — саме цього не було без історії
    expect(Object.keys(b.objects.toJSON()).sort()).toEqual(['s1', 's2']);
    sync(a.doc, b.doc);
    expect(a.objects.toJSON()).toEqual(b.objects.toJSON());
    // а от значення x — не 999: адди B зі снепшоту виграли за clientID.
    // це відомий компроміс «снепшот з REST як власні add», описаний у журналі
    // за 17.09; він псує поле, але не зʼїдає обʼєкт
    expect((b.objects.get('s1') as StickyObject).x).toBe(0);
  });

  it('чуже оновлення, застосоване до документа стору, зʼявляється в дзеркалі', () => {
    const remote = client();
    remote.objects.set('r1', sticky('r1', { text: 'з мережі' }));
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(remote.doc));
    expect((useBoardStore.getState().getById('r1') as StickyObject).text).toBe('з мережі');
  });
});
