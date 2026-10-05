import { afterEach, describe, expect, it } from 'vitest';
import type { BoardObject } from 'shared';
import { boardDoc, resetBoardDoc, useBoardStore } from './board-store';
import { adoptSyncStrategy, resolveSyncStrategy, setSyncStrategy, syncStrategy } from './sync-strategy';
import type { SyncStrategy } from './sync-strategy';

const sticky = (id: string): BoardObject =>
  ({
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    width: 160,
    height: 120,
    rotation: 0,
    zIndex: 0,
    createdBy: 'u1',
    createdAt: '2026-09-27T10:00:00.000Z',
    text: '',
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
  }) as BoardObject;

// у vitest «кадр» стору — мікротаска (див. nextFrame у board-store)
const nextFrame = () => new Promise<void>((r) => queueMicrotask(r));

// один жест: 30 подій руху, eventsPerFrame штук між кадрами, як їх шле миша
async function drag(strategy: SyncStrategy, eventsPerFrame: number) {
  setSyncStrategy(strategy);
  resetBoardDoc();
  const store = useBoardStore.getState();
  store.add(sticky('a'));
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  boardDoc.on('update', onUpdate);
  for (let i = 1; i <= 30; i++) {
    store.updateSoon('a', { x: i * 3, y: i * 2 });
    if (i % eventsPerFrame === 0) await nextFrame();
  }
  store.flushUpdates(); // dragend
  await nextFrame();
  boardDoc.off('update', onUpdate);
  return { updates: updates.length, final: JSON.stringify(useBoardStore.getState().getById('a')) };
}

afterEach(() => setSyncStrategy('batched'));

describe('стратегії синхронізації жесту', () => {
  it('batched: не більше одного апдейту на кадр, скільки б подій у ньому не було', async () => {
    // миша щокадру — кадрів 30, апдейтів 30
    expect((await drag('batched', 1)).updates).toBe(30);
    // миша з частим опитуванням — три події на кадр, 10 кадрів, 10 апдейтів
    expect((await drag('batched', 3)).updates).toBe(10);
  });

  it('per-event: кожна подія — свій апдейт, незалежно від кадрів', async () => {
    expect((await drag('per-event', 1)).updates).toBe(30);
    expect((await drag('per-event', 3)).updates).toBe(30);
  });

  it('кінцевий стан однаковий в обох стратегіях', async () => {
    const perEvent = await drag('per-event', 3);
    const batched = await drag('batched', 3);
    expect(batched.final).toBe(perEvent.final);
    expect(JSON.parse(batched.final)).toMatchObject({ x: 90, y: 60 });
  });
});

describe('resolveSyncStrategy', () => {
  it('за замовчуванням batched, і це лише запас — режим кімнати скаже сервер', () => {
    expect(resolveSyncStrategy('', undefined, false)).toEqual({ strategy: 'batched', forced: false });
  });

  it('?sync= у звичайній збірці не діє: режим кімнати не підмінити з адреси', () => {
    expect(resolveSyncStrategy('?sync=aoi', undefined, false)).toEqual({
      strategy: 'batched',
      forced: false,
    });
  });

  it('у збірці стенду ?sync= діє й стає примусом', () => {
    expect(resolveSyncStrategy('?sync=per-event', 'batched', true)).toEqual({
      strategy: 'per-event',
      forced: true,
    });
  });

  it('змінна збірки — запас, сміття ігнорується', () => {
    expect(resolveSyncStrategy('', 'per-event', false).strategy).toBe('per-event');
    expect(resolveSyncStrategy('?sync=nonsense', 'per-event', true).strategy).toBe('per-event');
    expect(resolveSyncStrategy('', 'nonsense', false).strategy).toBe('batched');
  });
});

describe('оголошення стратегії сервером', () => {
  it('кадр сервера перебиває місцевий запас', () => {
    setSyncStrategy('batched');
    adoptSyncStrategy('aoi');
    expect(syncStrategy()).toBe('aoi');
  });
});
