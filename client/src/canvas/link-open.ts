import { parseLinkUrl } from 'shared';

// відкриття картки в новій вкладці. Адресу перевіряємо ПЕРЕД відкриттям, хоч
// вона й перевірена при створенні: обʼєкт міг прийти з мережі від клієнта, на
// якого ми не впливаємо, а window.open із javascript: виконав би його
export function openLink(url: string) {
  const parsed = parseLinkUrl(url);
  if (!parsed) return false;
  // noopener — щоб відкрита сторінка не дотяглась до нашої через window.opener
  window.open(parsed.url, '_blank', 'noopener,noreferrer');
  return true;
}
