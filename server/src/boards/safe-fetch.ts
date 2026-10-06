import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

// Запит ЗА АДРЕСОЮ, ЯКУ ДАВ КОРИСТУВАЧ. Це найнебезпечніше, що взагалі робить
// цей сервер: без обмежень він став би засобом стукати у внутрішню мережу й
// хмарні метадані чужими руками (SSRF). Тому тут усе заборонено, крім
// явно дозволеного, і кожен редирект перевіряється наново.

export const PREVIEW_UA = 'CollabSpaceLinkPreview/1.0 (+link card preview)';
const MAX_REDIRECTS = 3;
const CONNECT_TIMEOUT_MS = 5000;

export class BlockedUrlError extends Error {}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
type LookupAllCallback = (
  err: NodeJS.ErrnoException | null,
  addresses: { address: string; family: number }[],
) => void;

// адреса в десятковому/вісімковому/шістнадцятковому вигляді (2130706433,
// 0x7f000001, 0177.0.0.1) — той самий localhost, лише записаний інакше.
// URL такі хости не нормалізує, тому розгортаємо самі
function expandNumericHost(host: string): string | null {
  const clean = host.replace(/\.$/, '');
  if (/^\d+$/.test(clean)) return intToIp(Number(clean));
  if (/^0x[0-9a-f]+$/i.test(clean)) return intToIp(Number.parseInt(clean, 16));
  if (/^0[0-7]+$/.test(clean)) return intToIp(Number.parseInt(clean, 8));
  // 0177.0.0.1 — частини з ведучим нулем теж вісімкові
  const parts = clean.split('.');
  if (parts.length === 4 && parts.every((p) => /^0[0-7]+$|^\d+$|^0x[0-9a-f]+$/i.test(p))) {
    const nums = parts.map((p) =>
      /^0x/i.test(p) ? Number.parseInt(p, 16) : /^0[0-7]+$/.test(p) ? Number.parseInt(p, 8) : Number(p),
    );
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return nums.join('.');
  }
  return null;
}

function intToIp(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

// усе, що веде всередину: локальне, приватне, link-local (туди ж 169.254.169.254
// з метаданими хмар), CGNAT, мультикаст і службове
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedIpv4(ip: string) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local і метадані 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true; // мультикаст і зарезервоване
  return false;
}

// ipv6 у вісім груп: URL нормалізує «::ffff:127.0.0.1» у «::ffff:7f00:1», тож
// шукати ipv4 крапками марно — розгортаємо адресу й дивимось на самі групи
function expandIpv6(ip: string): number[] | null {
  const [head, tail] = ip.split('::');
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => Number.parseInt(g, 16)));
  // в хвості ще може стояти ipv4 — тоді це дві останні групи
  const withIpv4 = (parts: string[]) => {
    const last = parts[parts.length - 1];
    if (!last || !last.includes('.')) return parts.map((g) => Number.parseInt(g, 16));
    const quad = last.split('.').map(Number);
    if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return [
      ...parts.slice(0, -1).map((g) => Number.parseInt(g, 16)),
      (quad[0] << 8) | quad[1],
      (quad[2] << 8) | quad[3],
    ];
  };
  const headGroups = head === '' ? [] : withIpv4(head.split(':'));
  const tailGroups = tail === undefined ? [] : tail === '' ? [] : withIpv4(tail.split(':'));
  if (headGroups === null || tailGroups === null) return null;
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill(0), ...tailGroups];
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  void parse;
  return groups;
}

function isBlockedIpv6(ip: string) {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const g = expandIpv6(lower);
  if (g === null) return true;

  // ::ffff:a.b.c.d і ::a.b.c.d — той самий ipv4, лише в обгортці
  const firstFiveZero = g.slice(0, 5).every((n) => n === 0);
  if (firstFiveZero && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = [(g[6] >> 8) & 255, g[6] & 255, (g[7] >> 8) & 255, g[7] & 255].join('.');
    // ::1 і :: — це петля й «будь-яка адреса», а не ipv4
    if (g[5] === 0 && g[6] === 0 && (g[7] === 1 || g[7] === 0)) return true;
    return isBlockedIpv4(v4);
  }
  if (g[0] === 0xfe80) return true; // link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((g[0] & 0xff00) === 0xff00) return true; // мультикаст
  if (g[0] === 0x2002) return true; // 6to4
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  return false;
}

export interface SafeUrl {
  url: URL;
  ip: string;
  family: 4 | 6;
}

// перевірка адреси РАЗОМ із розвʼязанням імені. Повертає саме ту адресу, на
// яку потім і підключаємось: інакше між перевіркою й запитом dns міг би
// віддати іншу адресу (DNS rebinding)
export async function resolveSafeUrl(raw: string): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Некоректна адреса');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Лише http і https');
  }
  // логін і пароль в адресі — спосіб підсунути чужі облікові дані цілі
  if (url.username !== '' || url.password !== '') {
    throw new BlockedUrlError('Адреса з обліковими даними не приймається');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const numeric = isIP(host) ? host : expandNumericHost(host);
  if (numeric) {
    if (isBlockedIp(numeric)) throw new BlockedUrlError('Внутрішня адреса');
    return { url, ip: numeric, family: isIP(numeric) === 6 ? 6 : 4 };
  }

  const resolved = await new Promise<{ address: string; family: number }>((ok, fail) => {
    dnsLookup(host, { verbatim: true }, (err, address, family) =>
      err ? fail(new BlockedUrlError("Імʼя не розвʼязується")) : ok({ address, family }),
    );
  });
  if (isBlockedIp(resolved.address)) throw new BlockedUrlError('Внутрішня адреса');
  return { url, ip: resolved.address, family: resolved.family === 6 ? 6 : 4 };
}

interface FetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
  location?: string;
}

// один запит до вже перевіреної адреси. Підключаємось САМЕ на перевірений ip:
// підміняємо lookup, а імʼя лишаємо в Host і в SNI, щоб сервер віддав те, що треба
function requestOnce(safe: SafeUrl, maxBytes: number, timeoutMs: number): Promise<FetchResult> {
  const { url, ip, family } = safe;
  const isHttps = url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;

  return new Promise<FetchResult>((ok, fail) => {
    let settled = false;
    const req = send(
      {
        protocol: url.protocol,
        host: url.hostname,
        servername: isHttps ? url.hostname : undefined,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'user-agent': PREVIEW_UA,
          accept: 'text/html,application/xhtml+xml,image/*;q=0.8',
          // кук не шлемо й не приймаємо: прев'ю не має ходити від чийогось імені
          'accept-encoding': 'identity',
        },
        // ось воно: імʼя вже розвʼязано, тут лише віддаємо готовий ip.
        // node питає з { all: true } і тоді чекає МАСИВ — без цього запит
        // падає на ERR_INVALID_IP_ADDRESS ще до зʼєднання
        lookup: ((hostname: string, opts: { all?: boolean }, cb: LookupCallback) => {
          void hostname;
          if (opts.all) (cb as unknown as LookupAllCallback)(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        }) as never,
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () => {
          if (settled) return;
          settled = true;
          ok({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
            finalUrl: url.toString(),
            location: res.headers.location ? String(res.headers.location) : undefined,
          });
        };
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // більше читати не треба: далі вже не вміст, а спосіб нас завалити
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', finish);
        res.on('close', finish);
      },
    );
    req.on('timeout', () => req.destroy(new BlockedUrlError('Час вийшов')));
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      fail(err instanceof BlockedUrlError ? err : new BlockedUrlError('Не вдалося зʼєднатись'));
    });
    req.end();
  });
}

export interface SafeFetchOptions {
  maxBytes: number;
  // дозволені типи вмісту; порожній масив — не перевіряти
  allowedTypes: string[];
  timeoutMs?: number;
}

export type Resolver = (raw: string) => Promise<SafeUrl>;

// публічний вхід: перевірити адресу, сходити, перевірити КОЖЕН редирект.
// resolver підміняють лише перевірки: там треба достукатись до локального
// сервера, якого захист — цілком слушно — не пускає
export async function safeFetch(
  raw: string,
  options: SafeFetchOptions,
  resolver: Resolver = resolveSafeUrl,
): Promise<FetchResult> {
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await resolver(target);
    const res = await requestOnce(safe, options.maxBytes, options.timeoutMs ?? CONNECT_TIMEOUT_MS);

    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop === MAX_REDIRECTS) throw new BlockedUrlError('Забагато перенаправлень');
      // відносний Location теж буває — зводимо до абсолютного й перевіряємо наново
      target = new URL(res.location, safe.url).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new BlockedUrlError(`Відповідь ${res.status}`);

    const type = res.contentType.split(';')[0].trim().toLowerCase();
    if (options.allowedTypes.length > 0 && !options.allowedTypes.includes(type)) {
      throw new BlockedUrlError(`Непідтримуваний тип ${type || 'невідомо'}`);
    }
    return { ...res, contentType: type, finalUrl: safe.url.toString() };
  }
  throw new BlockedUrlError('Забагато перенаправлень');
}
