import { describe, expect, it } from 'vitest';
import { contextRows, formatDuration } from './profile-card';
import type { ProfilePerson } from './profile-card';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const person: ProfilePerson = { userId: 'u1', displayName: 'Іван', avatarUrl: null, bio: null };
const withEmail = { ...person, email: 'ivan@test.local' };

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);
const value = (rows: { label: string; value: string }[], label: string) =>
  rows.find((r) => r.label === label)?.value;

describe('тривалість', () => {
  it('менше хвилини — окремий текст, без нуля', () => {
    expect(formatDuration(0)).toBe('менш як хвилина');
    expect(formatDuration(59_000)).toBe('менш як хвилина');
  });

  it('хвилини, години й дні округлює вниз', () => {
    expect(formatDuration(90_000)).toBe('1 хв');
    expect(formatDuration(3 * 3600_000 + 59 * 60_000)).toBe('3 год');
    expect(formatDuration(50 * 3600_000)).toBe('2 дн');
  });
});

describe('рядки картки', () => {
  it('на дошці: скільки в цьому сеансі й скільки в учасниках', () => {
    const rows = contextRows(
      person,
      {
        kind: 'presence',
        role: 'EDITOR',
        joinedAt: NOW - 12 * 60_000,
        memberSince: '2026-09-27T12:00:00Z',
      },
      NOW,
    );

    expect(labels(rows)).toEqual(['На дошці', 'Учасник']);
    expect(value(rows, 'На дошці')).toBe('12 хв');
    expect(value(rows, 'Учасник')).toBe('3 дн');
  });

  it('у списку учасників присутності нема зовсім', () => {
    const rows = contextRows(
      withEmail,
      { kind: 'membership', role: 'VIEWER', status: 'ACCEPTED', since: '2026-09-29T12:00:00Z' },
      NOW,
    );

    expect(labels(rows)).toEqual(['Пошта', 'Роль', 'Учасник']);
    expect(labels(rows)).not.toContain('На дошці');
    expect(value(rows, 'Роль')).toBe('Глядач');
  });

  it('запрошеному пишемо «запрошено», а не «учасник»', () => {
    const rows = contextRows(
      withEmail,
      { kind: 'membership', role: 'ADMIN', status: 'PENDING', since: '2026-09-30T10:00:00Z' },
      NOW,
    );

    expect(labels(rows)).toEqual(['Пошта', 'Роль', 'Запрошено']);
    expect(value(rows, 'Запрошено')).toBe('2 год');
  });

  it('пошти нема в присутності — рядка теж нема', () => {
    const rows = contextRows(
      person,
      { kind: 'presence', role: 'OWNER', joinedAt: NOW, memberSince: null },
      NOW,
    );
    expect(labels(rows)).toEqual(['На дошці']);
  });

  it('годинник браузера попереду серверного — не показуємо відʼємне', () => {
    const rows = contextRows(
      person,
      { kind: 'presence', role: 'OWNER', joinedAt: NOW + 5000, memberSince: null },
      NOW,
    );
    expect(value(rows, 'На дошці')).toBe('менш як хвилина');
  });
});
