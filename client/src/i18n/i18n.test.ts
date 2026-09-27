import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';
import { uk } from './uk';

// тип Translation уже не дає зібрати мову з пропущеним ключем; тут — те, чого
// тип не бачить: порожні рядки й загублені {{змінні}}
function leaves(obj: object, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : leaves(v, `${prefix}${k}.`),
  );
}

const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('переклади', () => {
  const base = Object.fromEntries(leaves(uk));

  for (const [name, dict] of [
    ['en', en],
    ['de', de],
  ] as const) {
    it(`${name}: ті самі ключі, без порожніх рядків, ті самі змінні`, () => {
      const own = Object.fromEntries(leaves(dict));
      expect(Object.keys(own).sort()).toEqual(Object.keys(base).sort());
      for (const [key, text] of Object.entries(own)) {
        expect(text.trim(), key).not.toBe('');
        expect(vars(text), key).toEqual(vars(base[key]));
      }
    });
  }
});
