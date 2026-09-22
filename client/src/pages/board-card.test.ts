import { describe, expect, it } from 'vitest';
import { colorForBoard, relativeTime } from './board-card';

const NOW = new Date('2026-09-22T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('відносний час у картці дошки', () => {
  it('свіже — «щойно»', () => {
    expect(relativeTime(ago(30_000), NOW)).toBe('щойно');
  });

  it('годинник клієнта попереду серверного — теж «щойно», не відʼємні хвилини', () => {
    expect(relativeTime(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe('щойно');
  });

  it('хвилини, години, дні', () => {
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe('5 хв тому');
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe('3 год тому');
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe('2 дн тому');
  });

  it('після тижня — коротка дата', () => {
    expect(relativeTime(ago(30 * 86_400_000), NOW)).toBe('23.08');
  });
});

describe('колір дошки', () => {
  it('той самий id — той самий колір', () => {
    expect(colorForBoard('abc')).toBe(colorForBoard('abc'));
  });

  it('різні дошки розходяться по палітрі', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(new Set(ids.map(colorForBoard)).size).toBeGreaterThan(1);
  });
});
