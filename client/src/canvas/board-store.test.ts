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

// клієнт у тесті — просто ще один Y.Doc з тією самою мапою, що й у сторі
function client() {
  const doc = new Y.Doc();
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

  it('чуже оновлення, застосоване до документа стору, зʼявляється в дзеркалі', () => {
    const remote = client();
    remote.objects.set('r1', sticky('r1', { text: 'з мережі' }));
    Y.applyUpdate(boardDoc, Y.encodeStateAsUpdate(remote.doc));
    expect((useBoardStore.getState().getById('r1') as StickyObject).text).toBe('з мережі');
  });
});
