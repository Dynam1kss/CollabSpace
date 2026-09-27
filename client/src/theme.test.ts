import { describe, expect, it } from 'vitest';
import { CANVAS_COLORS, DEFAULT_INK, inkFor } from './theme';

describe('inkFor', () => {
  it('у світлій темі колір як є', () => {
    expect(inkFor(DEFAULT_INK, 'light')).toBe(DEFAULT_INK);
  });

  it('у темній — лише дефолтне темне чорнило стає світлим, регістр не важить', () => {
    expect(inkFor(DEFAULT_INK, 'dark')).not.toBe(DEFAULT_INK);
    expect(inkFor(DEFAULT_INK.toUpperCase(), 'dark')).toBe(inkFor(DEFAULT_INK, 'dark'));
  });

  it('поверх стікера чи фігури — лишається темним і в темній темі', () => {
    expect(inkFor(DEFAULT_INK, 'dark', true)).toBe(DEFAULT_INK);
  });

  it('свідомо вибрані кольори не чіпаємо', () => {
    expect(inkFor('#fca5a5', 'dark')).toBe('#fca5a5');
    expect(inkFor('#000000', 'dark')).toBe('#000000');
  });
});

describe('CANVAS_COLORS', () => {
  it('у темній немає чисто чорного чи чисто білого тла', () => {
    expect(CANVAS_COLORS.dark.exportBg).not.toBe('#000000');
    expect(CANVAS_COLORS.dark.exportBg).not.toBe('#ffffff');
  });
});
