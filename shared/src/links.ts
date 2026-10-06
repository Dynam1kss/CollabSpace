// розбір адреси для картки-посилання. Живе в shared, бо однакову перевірку
// робить і клієнт (перед створенням обʼєкта), і сервер (zod на знімку): дві
// різні реалізації однієї перевірки — це спосіб пропустити щось в одній з них

export type LinkKind = 'web' | 'youtube';

export const LINK_URL_MAX = 2048;
export const LINK_TITLE_MAX = 120;

// id відео — рівно 11 символів цього набору. Перевірка не для краси: саме це
// значення підставляється в src iframe-а й у адресу мініатюри
const VIDEO_ID = /^[\w-]{11}$/;

// схема вже є в рядку: `javascript:`, `data:`, `mailto:` — усе це сюди впаде
// й далі відсіється по протоколу. Без цього «example.com» ми б не прийняли
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export interface ParsedLink {
  url: string;
  kind: LinkKind;
  videoId?: string;
}

// www. і m. на пізнаванні домену не впливають
function bareHost(hostname: string) {
  return hostname.replace(/^(www|m)\./, '');
}

function videoFrom(u: URL): string | null {
  const host = bareHost(u.hostname.toLowerCase());
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') return parts[0] ?? null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  // ?t=90 і ?list=... нас не цікавлять — беремо лише саме відео
  if (parts[0] === 'watch') return u.searchParams.get('v');
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') return parts[1] ?? null;
  return null;
}

// null — адресу не беремо. Повертає нормалізовану: URL сам опускає регістр
// хоста, прибирає стандартний порт і кодує все, що треба закодувати
export function parseLinkUrl(raw: string): ParsedLink | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // протокол-відносна «//host» — дописати треба лише схему, інакше хост
  // поїде в шлях і вийде адреса з порожнім хостом
  const withScheme = HAS_SCHEME.test(trimmed)
    ? trimmed
    : (trimmed.startsWith('//') ? 'https:' : 'https://') + trimmed;

  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  // «http://» без хоста парситься, але нікуди не веде
  if (u.hostname === '') return null;

  const url = u.toString();
  if (url.length > LINK_URL_MAX) return null;

  const videoId = videoFrom(u);
  if (videoId && VIDEO_ID.test(videoId)) return { url, kind: 'youtube', videoId };
  return { url, kind: 'web' };
}

export function isLinkUrl(raw: string) {
  return parseLinkUrl(raw) !== null;
}

export function isVideoId(value: string) {
  return VIDEO_ID.test(value);
}

// що показати на картці, коли свого підпису немає
export function linkDomain(url: string) {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return url;
  }
}
