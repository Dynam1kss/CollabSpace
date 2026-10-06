import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockedUrlError, isBlockedIp, PREVIEW_UA, resolveSafeUrl, safeFetch } from '../src/boards/safe-fetch';
import { extractPreview, imageSize } from '../src/boards/link-preview.service';

// Запити за адресою, яку дав користувач, — найнебезпечніше місце сервера.
// Кожне правило тут має свою перевірку: впаде одна — впаде саме та, що треба

const blocked = async (url: string) => {
  await expect(resolveSafeUrl(url), url).rejects.toBeInstanceOf(BlockedUrlError);
};

describe('захист від SSRF: які адреси не беремо', () => {
  it('лише http і https', async () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/x',
      'gopher://example.com/',
      'data:text/html,<script>',
      'javascript:alert(1)',
    ]) {
      await blocked(url);
    }
  });

  it('облікові дані в адресі', async () => {
    await blocked('http://user:pass@93.184.216.34/');
    await blocked('http://user@93.184.216.34/');
  });

  it('локальне, приватне й link-local — у всіх звичних записах', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.0.0.1:8080/x',
      'http://localhost/',
      'http://10.0.0.5/',
      'http://172.16.3.4/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://224.0.0.1/',
    ]) {
      await blocked(url);
    }
  });

  it('десятковий, шістнадцятковий і вісімковий запис того самого localhost', async () => {
    for (const url of [
      'http://2130706433/',
      'http://0x7f000001/',
      'http://017700000001/',
      'http://0177.0.0.1/',
      'http://127.0.0.1./',
    ]) {
      await blocked(url);
    }
  });

  it('ipv6: петля, link-local, unique-local і ipv4 в обгортці', async () => {
    for (const url of [
      'http://[::1]/',
      'http://[::]/',
      'http://[fe80::1]/',
      'http://[fc00::1]/',
      'http://[fd12:3456::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/',
      'http://[ff02::1]/',
    ]) {
      await blocked(url);
    }
  });

  it('isBlockedIp: публічні адреси проходять, усе інше — ні', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    // саме так URL нормалізує ::ffff:127.0.0.1 і ::ffff:169.254.169.254
    expect(isBlockedIp('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true);
    expect(isBlockedIp('2002:7f00:1::1')).toBe(true);
    expect(isBlockedIp('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedIp('не адреса')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

// справжній локальний сервер: перевіряємо поведінку запиту, а не лише адреси.
// адресу віддаємо як 127.0.0.1, тож safeFetch сюди не пустить — тому ці
// перевірки ходять не через resolveSafeUrl, а напряму до відповідей
describe('захист від SSRF: поведінка самого запиту', () => {
  let server: Server;
  let port = 0;
  const seen: { ua?: string; cookie?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ ua: req.headers['user-agent'], cookie: req.headers.cookie });
      const url = req.url ?? '/';
      if (url === '/html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><head><title>Привіт</title></head><body>тіло</body></html>');
        return;
      }
      if (url === '/json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      if (url === '/huge') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(200_000));
        return;
      }
      if (url.startsWith('/redir')) {
        const next = Number(url.slice('/redir'.length) || '0') + 1;
        res.writeHead(302, { location: `/redir${next}` });
        res.end();
        return;
      }
      if (url === '/to-internal') {
        res.writeHead(302, { location: 'http://127.0.0.1:1/' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  // захист локальний сервер — цілком слушно — не пускає, тож для перевірок
  // САМОГО запиту підміняємо розвʼязувач: він пропускає лише цей порт, а все
  // інше (зокрема цілі редиректів) віддає справжній перевірці
  const local = (path: string) => `http://127.0.0.1:${port}${path}`;
  const onlyTestServer = async (raw: string) => {
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' && url.port === String(port)) {
      return { url, ip: '127.0.0.1', family: 4 as const };
    }
    return resolveSafeUrl(raw);
  };

  it('сам локальний сервер справжня перевірка не пускає', async () => {
    await expect(safeFetch(local('/html'), { maxBytes: 1000, allowedTypes: [] })).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it('html читається, User-Agent сталий, кук не шлемо', async () => {
    seen.length = 0;
    const res = await safeFetch(local('/html'), { maxBytes: 1024 * 1024, allowedTypes: ['text/html'] }, onlyTestServer);
    expect(res.body.toString()).toContain('Привіт');
    expect(seen[0].ua).toBe(PREVIEW_UA);
    expect(seen[0].cookie).toBeUndefined();
  });

  it('тільки text/html: json не беремо', async () => {
    await expect(
      safeFetch(local('/json'), { maxBytes: 1000, allowedTypes: ['text/html'] }, onlyTestServer),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('читаємо не більше дозволеного', async () => {
    const res = await safeFetch(local('/huge'), { maxBytes: 4096, allowedTypes: ['text/html'] }, onlyTestServer);
    expect(res.body.length).toBeLessThanOrEqual(4096);
  });

  it('більше трьох перенаправлень — відмова', async () => {
    await expect(
      safeFetch(local('/redir'), { maxBytes: 1000, allowedTypes: ['text/html'] }, onlyTestServer),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('редирект у внутрішню адресу перевіряється наново й відсікається', async () => {
    await expect(
      safeFetch(local('/to-internal'), { maxBytes: 1000, allowedTypes: ['text/html'] }, onlyTestServer),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('розбір сторінки: title, опис, site_name і відносна картинка', () => {
    const html = `<html><head>
      <meta property="og:title" content="Назва &amp; штука">
      <meta name="description" content="${'д'.repeat(400)}">
      <meta property="og:site_name" content="Сайт">
      <meta property="og:image" content="/img/cover.png">
    </head></html>`;
    const p = extractPreview(html, 'https://example.com/page/one');
    expect(p.title).toBe('Назва & штука');
    expect(p.siteName).toBe('Сайт');
    expect(p.image).toBe('https://example.com/img/cover.png');
    expect(p.description!.length).toBeLessThanOrEqual(300);
  });

  it('розбір сторінки: без og беремо <title>, без картинки — нічого', () => {
    const p = extractPreview('<html><head><title>  Просто   назва </title></head></html>', 'https://a.test/');
    expect(p.title).toBe('Просто назва');
    expect(p.image).toBeUndefined();
    expect(p.description).toBeUndefined();
  });

  it('розмір растра читається з байтів png', () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(360, 20);
    expect(imageSize(png)).toEqual({ width: 640, height: 360 });
    expect(imageSize(Buffer.alloc(4))).toBeNull();
  });
});
