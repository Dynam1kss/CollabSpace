import { dateLocale, i18n } from '../i18n';
import { colorForUser } from '../canvas/presence-colors';

// у дошки нема поля кольору і заводити його нема за чим: смужка потрібна лише
// щоб сітка не була однотонною. Беремо той самий djb2 + палітру, що й для
// людей, — id дошки такий самий стабільний рядок, як і id користувача
export function colorForBoard(boardId: string) {
  return colorForUser(boardId);
}

// запрошення й нові дошки підтягуються самі — без ws, раз на півхвилини досить
export const LISTS_POLL_MS = 25_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// далі «днів тому» вже не читається — простіше показати дату
const SHORT_DATE_AFTER = 7 * DAY;

// «оновлено 3 год тому». Без Intl.RelativeTimeFormat: форм усього чотири, і
// скорочені («хв», «год») обходять множину в усіх трьох мовах
export function relativeTime(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  // годинник на клієнті може відставати від серверного — майбутнє показуємо
  // як «щойно», а не як відʼємні хвилини
  if (diff < MINUTE) return i18n.t('time.justNow');
  if (diff < HOUR) return i18n.t('time.minutesAgo', { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return i18n.t('time.hoursAgo', { count: Math.floor(diff / HOUR) });
  if (diff < SHORT_DATE_AFTER) return i18n.t('time.daysAgo', { count: Math.floor(diff / DAY) });
  return new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: '2-digit' });
}
