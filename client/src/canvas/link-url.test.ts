import { describe, expect, it } from 'vitest';
import { linkDomain, LINK_URL_MAX, linkKind, linkVideoId, parseLinkUrl } from 'shared';

const id = 'dQw4w9WgXcQ';

describe('розбір адреси посилання', () => {
  it('усі формати youtube дають один і той самий videoId', () => {
    const variants = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}`,
      `http://www.youtube.com/watch?v=${id}&t=90s`,
      `https://www.youtube.com/watch?v=${id}&list=PL123&index=4`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?t=42`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      // без схеми — дописуємо https
      `youtu.be/${id}`,
    ];
    for (const raw of variants) {
      const parsed = parseLinkUrl(raw);
      expect(parsed, raw).not.toBeNull();
      expect(parsed!.kind, raw).toBe('youtube');
      expect(parsed!.videoId, raw).toBe(id);
    }
  });

  it('звичайні адреси — web, без videoId', () => {
    for (const raw of [
      'https://example.com',
      'http://example.com/a/b?c=1#d',
      'example.com',
      // youtube, але не відео — це просто сторінка
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=cats',
      // id не тієї довжини — теж не відео
      'https://youtu.be/short',
    ]) {
      const parsed = parseLinkUrl(raw);
      expect(parsed, raw).not.toBeNull();
      expect(parsed!.kind, raw).toBe('web');
      expect(parsed!.videoId, raw).toBeUndefined();
    }
  });

  it('вороже на вхід — null, а не «якось та зійде»', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'mailto:someone@example.com',
      'tel:+380000000000',
      'blob:https://example.com/abc',
      'about:blank',
      'ws://example.com/socket',
      'http://',
      'https://',
      '',
      '   ',
      // довша за межу
      'https://example.com/' + 'a'.repeat(LINK_URL_MAX),
    ]) {
      expect(parseLinkUrl(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('нормалізація: хост у нижній регістр, стандартний порт геть', () => {
    expect(parseLinkUrl('HTTPS://Example.COM:443/Path')!.url).toBe('https://example.com/Path');
    expect(parseLinkUrl('http://example.com:80/')!.url).toBe('http://example.com/');
    // протокол-відносна адреса: хост має лишитись хостом, а не поїхати в шлях
    expect(parseLinkUrl('//example.com/x')!.url).toBe('https://example.com/x');
  });

  it('домен для підпису — без www і m', () => {
    expect(linkDomain('https://www.example.com/a')).toBe('example.com');
    expect(linkDomain('https://m.youtube.com/watch?v=x')).toBe('youtube.com');
    expect(linkDomain('не адреса')).toBe('не адреса');
  });

  it('kind і videoId беруться лише з url, збережені поля не читаються', () => {
    expect(linkKind({ url: `https://youtu.be/${id}` })).toBe('youtube');
    expect(linkVideoId({ url: `https://youtu.be/${id}` })).toBe(id);
    // адреса не youtube — ніякого відео, хоч би що лежало в полях обʼєкта
    expect(linkKind({ url: 'https://example.com' })).toBe('web');
    expect(linkVideoId({ url: 'https://example.com' })).toBeUndefined();
    // адреса, яку ми взагалі не беремо, малюється як web і без відео
    expect(linkKind({ url: 'javascript:alert(1)' })).toBe('web');
    expect(linkVideoId({ url: 'javascript:alert(1)' })).toBeUndefined();
  });
});
