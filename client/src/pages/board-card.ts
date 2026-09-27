import { colorForUser } from '../canvas/presence-colors';

// у дошки нема поля кольору і заводити його нема за чим: смужка потрібна лише
// щоб сітка не була однотонною. Беремо той самий djb2 + палітру, що й для
// людей, — id дошки такий самий стабільний рядок, як і id користувача
export function colorForBoard(boardId: string) {
  return colorForUser(boardId);
}

export const ROLE_TEXT = {
  OWNER: 'власник',
  ADMIN: 'адміністратор',
  EDITOR: 'редактор',
  VIEWER: 'глядач',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// далі «днів тому» вже не читається — простіше показати дату
const SHORT_DATE_AFTER = 7 * DAY;

// «оновлено 3 год тому». Без залежностей: цілий Intl.RelativeTimeFormat тут
// зайвий, форм усього чотири
export function relativeTime(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  // годинник на клієнті може відставати від серверного — майбутнє показуємо
  // як «щойно», а не як відʼємні хвилини
  if (diff < MINUTE) return 'щойно';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} хв тому`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} год тому`;
  if (diff < SHORT_DATE_AFTER) return `${Math.floor(diff / DAY)} дн тому`;
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
}
