import type { BoardRole, MemberStatus } from 'shared';
import { i18n } from '../i18n';

// кого показуємо. email є не скрізь: у списку присутніх його нема й не буде —
// присутність іде через ws і пошти в собі не несе
export interface ProfilePerson {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  email?: string;
}

// звідки картку відкрили. На живій дошці є присутність, у списках учасників і
// запрошень її нема й бути не може: там людини на дошці зараз просто немає
export type ProfileContext =
  | { kind: 'presence'; role: 'OWNER' | BoardRole; joinedAt: number; memberSince: string | null }
  | { kind: 'membership'; role: BoardRole; status: MemberStatus; since: string };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// тривалість, а не «скільки тому»: ті самі чотири форми, що в relativeTime,
// але без хвоста «тому» — «на дошці 12 хв» читається, «на дошці 12 хв тому» ні
export function formatDuration(ms: number) {
  if (ms < MINUTE) return i18n.t('duration.underMinute');
  if (ms < HOUR) return i18n.t('duration.minutes', { count: Math.floor(ms / MINUTE) });
  if (ms < DAY) return i18n.t('duration.hours', { count: Math.floor(ms / HOUR) });
  return i18n.t('duration.days', { count: Math.floor(ms / DAY) });
}

interface Row {
  label: string;
  value: string;
}

// рядки під підписом — залежать від того, звідки картку відкрили. Одна
// функція на обидва випадки: сам компонент про контексти вже не думає
export function contextRows(person: ProfilePerson, context: ProfileContext, now = Date.now()): Row[] {
  const rows: Row[] = [];
  if (person.email) rows.push({ label: i18n.t('auth.email'), value: person.email });

  if (context.kind === 'presence') {
    // годинник браузера може відставати від серверного — відʼємне показуємо
    // як щойно, а не як мінус хвилини
    rows.push({
      label: i18n.t('profile.onBoard'),
      value: formatDuration(Math.max(0, now - context.joinedAt)),
    });
    if (context.memberSince) {
      rows.push({
        label: i18n.t('profile.memberFor'),
        value: formatDuration(Math.max(0, now - new Date(context.memberSince).getTime())),
      });
    }
    return rows;
  }

  rows.push({ label: i18n.t('profile.role'), value: i18n.t(`roleNames.${context.role}`) });
  const since = formatDuration(Math.max(0, now - new Date(context.since).getTime()));
  // запрошеному ще нема чого бути «учасником з» — у нього доступу поки нема
  rows.push({
    label: i18n.t(context.status === 'PENDING' ? 'profile.invitedAgo' : 'profile.memberFor'),
    value: since,
  });
  return rows;
}
