import { describe, expect, it } from 'vitest';
import type { BoardObject, StickyObject } from 'shared';
import { deletableIds, isMovable } from './object-lock';
import { lockedObjectIds } from './presence-store';

function sticky(id: string, extra: Partial<StickyObject> = {}): BoardObject {
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
    createdAt: '2026-09-23T00:00:00.000Z',
    text: '',
    fillColor: '#fef08a',
    textColor: '#1f2937',
    column: null,
    ...extra,
  };
}

describe('замок на обʼєкті', () => {
  it('замкнений не рухається, як і зайнятий іншим', () => {
    expect(isMovable(sticky('a'), new Set())).toBe(true);
    expect(isMovable(sticky('a', { locked: true }), new Set())).toBe(false);
    expect(isMovable(sticky('a'), new Set(['a']))).toBe(false);
  });

  it('старий знімок без поля — це не замок', () => {
    expect(isMovable(sticky('a', { locked: undefined }), new Set())).toBe(true);
    expect(isMovable(sticky('a', { locked: false }), new Set())).toBe(true);
  });

  it('видалення обходить замкнене, решту виділеного зносить', () => {
    const selected = [sticky('a'), sticky('b', { locked: true }), sticky('c')];
    expect(deletableIds(selected, new Set())).toEqual(['a', 'c']);
  });

  it('саме лише замкнене не дає нічого для видалення', () => {
    expect(deletableIds([sticky('a', { locked: true })], new Set())).toEqual([]);
    // зниклий обʼєкт (виділення пережило чуже видалення) теж не рахується
    expect(deletableIds([undefined], new Set())).toEqual([]);
  });

  it('замок присутності й прапорець рахуються разом', () => {
    const selected = [sticky('a'), sticky('b', { locked: true }), sticky('c')];
    expect(deletableIds(selected, new Set(['a']))).toEqual(['c']);
  });

  it('свій власний замок присутності мені не заважає', () => {
    const state = { selfClientId: 1, locks: { 1: 'a', 2: 'b' } };
    expect([...lockedObjectIds(state)]).toEqual(['b']);
  });
});
