import { afterEach, describe, expect, it } from 'vitest';
import {
  loadShowViewTargets,
  parseShowViewTargets,
  saveShowViewTargets,
  serializeShowViewTargets,
  showViewTargetsKey,
} from './show-view-targets';

// у vitest середовище node, справжнього localStorage тут нема — підставляємо
// найпростішу мапу, а окремим тестом ще й сховище, яке кидає (приватне вікно)
function fakeStorage(throwing = false) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => {
      if (throwing) throw new Error('storage disabled');
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throwing) throw new Error('storage disabled');
      data.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  return data;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('кому показувати свій вид', () => {
  it('ключ розділяє і дошки, і акаунти в одному браузері', () => {
    expect(showViewTargetsKey('b1', 'u1')).toBe('collabspace:show-view-targets:b1:u1');
    expect(showViewTargetsKey('b1', 'u2')).not.toBe(showViewTargetsKey('b1', 'u1'));
    expect(showViewTargetsKey('b2', 'u1')).not.toBe(showViewTargetsKey('b1', 'u1'));
  });

  it('порожнє, зіпсоване й чуже за типом читається як «усім»', () => {
    expect(parseShowViewTargets(null)).toBe('all');
    expect(parseShowViewTargets('[]')).toBe('all');
    expect(parseShowViewTargets('не json')).toBe('all');
    expect(parseShowViewTargets('{"a":1}')).toBe('all');
    expect(parseShowViewTargets('"all"')).toBe('all');
  });

  it('список id лишається списком, не-рядки з нього випадають', () => {
    expect(parseShowViewTargets('["u1","u2"]')).toEqual(['u1', 'u2']);
    expect(parseShowViewTargets('["u1",7,null]')).toEqual(['u1']);
  });

  it('записане читається назад тим самим', () => {
    fakeStorage();
    saveShowViewTargets('b1', 'u1', ['u2', 'u3']);
    expect(loadShowViewTargets('b1', 'u1')).toEqual(['u2', 'u3']);
    saveShowViewTargets('b1', 'u1', 'all');
    expect(loadShowViewTargets('b1', 'u1')).toBe('all');
  });

  it('вибір на одній дошці не видно на іншій', () => {
    fakeStorage();
    saveShowViewTargets('b1', 'u1', ['u2']);
    expect(loadShowViewTargets('b2', 'u1')).toBe('all');
  });

  it('людина, якої зараз нема на дошці, з вибору не зникає', () => {
    expect(parseShowViewTargets(serializeShowViewTargets(['офлайн', 'u2']))).toEqual(['офлайн', 'u2']);
  });

  it('сховище, яке кидає, не валить нічого — просто «усім»', () => {
    fakeStorage(true);
    expect(() => saveShowViewTargets('b1', 'u1', ['u2'])).not.toThrow();
    expect(loadShowViewTargets('b1', 'u1')).toBe('all');
  });

  it('без localStorage взагалі теж не падає', () => {
    expect(loadShowViewTargets('b1', 'u1')).toBe('all');
    expect(() => saveShowViewTargets('b1', 'u1', 'all')).not.toThrow();
  });
});
