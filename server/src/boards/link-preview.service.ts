import { createHash, randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EXT_BY_MIME, UPLOADS_DIR } from './images.routes';
import { BlockedUrlError, safeFetch } from './safe-fetch';

// скільки читаємо зі сторінки: усе потрібне (og-теги) лежить у <head>, тож
// півмегабайта з головою, а решта — чужий трафік на нашому каналі
const MAX_HTML_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION = 300;
const MAX_TITLE = 200;

export interface LinkPreview {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  imageAspect?: number;
}

// мінімальний розбір сутностей — повного декодера тут не треба, у заголовках
// трапляються рівно ці п'ять
function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function clean(value: string | undefined, max: number) {
  if (!value) return undefined;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (text === '') return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// витягуємо узагальнено, без коду «під сайт»: беремо те, що сайти самі
// оголошують для попереднього перегляду
function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    // property= і name= трапляються обидва, порядок атрибутів будь-який
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`,
      'i',
    );
    const tag = pattern.exec(html)?.[0];
    if (!tag) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content && content.trim() !== '') return content;
  }
  return undefined;
}

export function extractPreview(html: string, baseUrl: string): LinkPreview {
  const title =
    clean(metaContent(html, ['og:title', 'twitter:title']), MAX_TITLE) ??
    clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1], MAX_TITLE);
  const description = clean(
    metaContent(html, ['og:description', 'twitter:description', 'description']),
    MAX_DESCRIPTION,
  );
  const siteName = clean(metaContent(html, ['og:site_name']), MAX_TITLE);
  const rawImage = metaContent(html, ['og:image', 'og:image:url', 'twitter:image']);

  let image: string | undefined;
  if (rawImage) {
    try {
      // відносний шлях у og:image — звичайна річ
      image = new URL(decodeEntities(rawImage).trim(), baseUrl).toString();
    } catch {
      image = undefined;
    }
  }
  return { title, description, siteName, image };
}

// розміри растра з самих байтів: ширину й висоту знають png, jpeg, gif і webp,
// і читати їх дешевше, ніж тягнути бібліотеку заради одного числа
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  // png: IHDR одразу після підпису
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // gif87a/89a
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // webp (VP8 / VP8L / VP8X)
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // jpeg: ідемо по сегментах до SOFn
  if (buf.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      // SOF0..SOF15, крім таблиць DHT/JPG/DAC
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

// картинку зберігаємо В СЕБЕ й віддаємо свій шлях: інакше кожен глядач дошки
// ходив би по неї на сторонній хост і світив там свою адресу
// спільна тека, а не тека дошки: кеш прев'ю один на сервер, і та сама
// картинка не має залежати від того, хто перший кинув посилання
const PREVIEW_DIR = 'link-preview';

async function storeImage(url: string): Promise<{ path: string; aspect?: number } | null> {
  try {
    const res = await safeFetch(url, {
      maxBytes: MAX_IMAGE_BYTES,
      allowedTypes: Object.keys(EXT_BY_MIME),
    });
    const ext = EXT_BY_MIME[res.contentType];
    if (!ext || res.body.length === 0) return null;
    const dir = resolve(UPLOADS_DIR, PREVIEW_DIR);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(resolve(dir, name), res.body);
    const size = imageSize(res.body);
    return {
      path: `/uploads/${PREVIEW_DIR}/${name}`,
      aspect: size && size.height > 0 ? size.width / size.height : undefined,
    };
  } catch {
    // без картинки картка просто лишиться текстовою
    return null;
  }
}

// скільки тримаємо розібраний корінь сайту: він міняється рідко, а в одну
// дошку часто кидають кілька посилань на той самий сайт підряд
const ROOT_TTL_MS = 5 * 60 * 1000;
const ROOT_CACHE_MAX = 50;
const rootCache = new Map<string, { at: number; preview: LinkPreview | null }>();

function readRootCache(origin: string) {
  const hit = rootCache.get(origin);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ROOT_TTL_MS) {
    rootCache.delete(origin);
    return undefined;
  }
  return hit.preview;
}

function writeRootCache(origin: string, preview: LinkPreview | null) {
  // найстаріший запис виходить першим — Map тримає порядок вставки
  if (rootCache.size >= ROOT_CACHE_MAX) {
    const oldest = rootCache.keys().next().value;
    if (oldest !== undefined) rootCache.delete(oldest);
  }
  rootCache.set(origin, { at: Date.now(), preview });
}

// лише для перевірок: між ними кеш не має протікати
export function clearRootCache() {
  rootCache.clear();
}

// сторінку глибше кореня часто віддає порожня оболонка застосунку: розмітку
// там малює javascript, а og-тегів немає взагалі. Тоді беремо бракуючі поля з
// кореня сайту — це не «логіка під сайт», а те саме правило для всіх
export type HtmlLoader = (url: string) => Promise<{ html: string; finalUrl: string }>;

const loadHtmlOverNetwork: HtmlLoader = async (url) => {
  const res = await safeFetch(url, { maxBytes: MAX_HTML_BYTES, allowedTypes: ['text/html'] });
  return { html: res.body.toString('utf8'), finalUrl: res.finalUrl };
};

function rootOf(url: string): string | null {
  const u = new URL(url);
  // вже корінь — другий запит був би за тією самою сторінкою
  if (u.pathname === '/') return null;
  return `${u.protocol}//${u.host}/`;
}

// що знайшлось на глибокій сторінці, те й лишається; з кореня беремо ТІЛЬКИ
// порожні поля
function fillGaps(page: LinkPreview, root: LinkPreview): LinkPreview {
  return {
    title: page.title ?? root.title,
    description: page.description ?? root.description,
    siteName: page.siteName ?? root.siteName,
    image: page.image ?? root.image,
  };
}

async function rootPreview(url: string, loadHtml: HtmlLoader): Promise<LinkPreview | null> {
  const root = rootOf(url);
  if (root === null) return null;
  const cached = readRootCache(root);
  if (cached !== undefined) return cached;

  let preview: LinkPreview | null;
  try {
    // ТОЙ САМИЙ шлях, що й перший запит: ті самі перевірки адреси, обмеження
    // обсягу й часу, ті самі правила перенаправлень
    const page = await loadHtml(root);
    preview = extractPreview(page.html, page.finalUrl);
  } catch {
    // корінь не віддався (заборонена адреса, таймаут, не html) — не біда,
    // картка лишиться з тим, що знайшлось на самій сторінці
    preview = null;
  }
  writeRootCache(root, preview);
  return preview;
}

// кеш на диску, а не в памʼяті: після перезапуску сервера дошка з десятком
// посилань інакше знову пішла б у мережу за кожним — і з'їла б ліміт
export const CACHE_DIR = resolve(UPLOADS_DIR, '..', 'cache', 'link-preview');
export const PREVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile(url: string) {
  return resolve(CACHE_DIR, `${createHash('sha256').update(url).digest('hex')}.json`);
}

// синхронна перевірка свіжості: обмежувач запитів мусить вирішити, чи взагалі
// витрачати слот, ще до того, як ми щось читатимемо
export function isCachedFresh(url: string) {
  try {
    const file = cacheFile(url);
    if (!existsSync(file)) return false;
    return Date.now() - statSync(file).mtimeMs < PREVIEW_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

async function readCache(url: string): Promise<LinkPreview | null> {
  if (!isCachedFresh(url)) return null;
  try {
    return JSON.parse(await readFile(cacheFile(url), 'utf8')) as LinkPreview;
  } catch {
    return null;
  }
}

async function writeCache(url: string, preview: LinkPreview) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cacheFile(url), JSON.stringify(preview), 'utf8');
  } catch {
    // кеш — лише прискорення; не записався, то й по тому
  }
}

export interface PreviewDeps {
  loadHtml?: HtmlLoader;
  saveImage?: (url: string) => Promise<{ path: string; aspect?: number } | null>;
  // кеш обходимо лише в перевірках
  skipCache?: boolean;
}

export async function buildPreview(url: string, deps: PreviewDeps = {}): Promise<LinkPreview> {
  const loadHtml = deps.loadHtml ?? loadHtmlOverNetwork;
  const saveImage = deps.saveImage ?? storeImage;

  if (!deps.skipCache) {
    const cached = await readCache(url);
    if (cached) return cached;
  }

  const page = await loadHtml(url);
  let preview = extractPreview(page.html, page.finalUrl);

  if (!preview.image || !preview.description) {
    const root = await rootPreview(url, loadHtml);
    if (root) preview = fillGaps(preview, root);
  }

  let result: LinkPreview;
  if (!preview.image) {
    result = { ...preview, image: undefined };
  } else {
    const stored = await saveImage(preview.image);
    result = { ...preview, image: stored?.path, imageAspect: stored?.aspect };
  }
  if (!deps.skipCache) await writeCache(url, result);
  return result;
}

export { BlockedUrlError };
