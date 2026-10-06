import { beforeEach, describe, expect, it } from 'vitest';
import { buildPreview, clearRootCache } from '../src/boards/link-preview.service';
import { BlockedUrlError } from '../src/boards/safe-fetch';
import type { HtmlLoader } from '../src/boards/link-preview.service';

// сторінку глибше кореня часто віддає порожня оболонка застосунку (spotify,
// soundcloud та інші): розмітку малює javascript, og-тегів немає. Тоді
// бракуюче добираємо з кореня сайту — однаково для всіх, без коду «під сайт»

const DEEP = 'https://open.spotify.com/collection/tracks';
const ROOT = 'https://open.spotify.com/';

const html = (tags: string) => `<html><head>${tags}</head><body></body></html>`;

const rootHtml = html(`
  <meta property="og:title" content="Spotify">
  <meta property="og:description" content="Опис із кореня">
  <meta property="og:site_name" content="Spotify">
  <meta property="og:image" content="/root.png">
`);

// лічильник звернень — щоб бачити, скільки разів ми справді ходили в мережу
function loader(pages: Record<string, string>, fails: Record<string, Error> = {}) {
  const calls: string[] = [];
  const load: HtmlLoader = async (url) => {
    calls.push(url);
    if (fails[url]) throw fails[url];
    const page = pages[url];
    if (page === undefined) throw new BlockedUrlError(`немає сторінки ${url}`);
    return { html: page, finalUrl: url };
  };
  return { load, calls };
}

// картинку нікуди не зберігаємо: цей зріз про метадані, не про файли
const saveImage = async (_boardId: string, url: string) => ({ path: `/uploads/b/${url.split('/').pop()}` });

beforeEach(() => clearRootCache());

describe('прев’ю: добір бракуючого з кореня сайту', () => {
  it('на глибокій сторінці немає нічого — усе береться з кореня', async () => {
    const { load, calls } = loader({ [DEEP]: html(''), [ROOT]: rootHtml });
    const preview = await buildPreview('b', DEEP, { loadHtml: load, saveImage });

    expect(preview).toMatchObject({
      title: 'Spotify',
      description: 'Опис із кореня',
      siteName: 'Spotify',
      image: '/uploads/b/root.png',
    });
    expect(calls).toEqual([DEEP, ROOT]);
  });

  it('свій og:title лишається, а опис і картинка приходять з кореня', async () => {
    const { load } = loader({
      [DEEP]: html('<meta property="og:title" content="Мої пісні">'),
      [ROOT]: rootHtml,
    });
    const preview = await buildPreview('b', DEEP, { loadHtml: load, saveImage });

    expect(preview.title).toBe('Мої пісні');
    expect(preview.description).toBe('Опис із кореня');
    expect(preview.image).toBe('/uploads/b/root.png');
  });

  it('на глибокій сторінці все своє — у корінь не ходимо', async () => {
    const { load, calls } = loader({
      [DEEP]: html(`
        <meta property="og:title" content="Повна">
        <meta property="og:description" content="Свій опис">
        <meta property="og:image" content="/deep.png">
      `),
      [ROOT]: rootHtml,
    });
    const preview = await buildPreview('b', DEEP, { loadHtml: load, saveImage });

    expect(preview.title).toBe('Повна');
    expect(preview.description).toBe('Свій опис');
    expect(preview.image).toBe('/uploads/b/deep.png');
    expect(calls).toEqual([DEEP]);
  });

  it('корінь не віддався — картка все одно повертається з тим, що є', async () => {
    const { load, calls } = loader(
      { [DEEP]: html('<meta property="og:title" content="Лише назва">') },
      { [ROOT]: new BlockedUrlError('внутрішня адреса') },
    );
    const preview = await buildPreview('b', DEEP, { loadHtml: load, saveImage });

    expect(preview.title).toBe('Лише назва');
    expect(preview.description).toBeUndefined();
    expect(preview.image).toBeUndefined();
    expect(calls).toEqual([DEEP, ROOT]);
  });

  it('корінь, що веде на приватну адресу, відхиляється — і нічого звідти не беремо', async () => {
    // саме це кидає safeFetch, коли перевіряє ціль перенаправлення
    const { load } = loader(
      { [DEEP]: html('') },
      { [ROOT]: new BlockedUrlError('Внутрішня адреса') },
    );
    const preview = await buildPreview('b', DEEP, { loadHtml: load, saveImage });

    expect(preview.title).toBeUndefined();
    expect(preview.description).toBeUndefined();
    expect(preview.image).toBeUndefined();
  });

  it('адреса вже кореневa — другого запиту немає', async () => {
    const { load, calls } = loader({ [ROOT]: html('<meta property="og:title" content="Корінь">') });
    const preview = await buildPreview('b', ROOT, { loadHtml: load, saveImage });

    expect(preview.title).toBe('Корінь');
    expect(calls).toEqual([ROOT]);
  });

  it('корінь береться з памʼяті: друга картка того самого сайту його не перечитує', async () => {
    const { load, calls } = loader({
      [DEEP]: html(''),
      'https://open.spotify.com/album/42': html(''),
      [ROOT]: rootHtml,
    });
    await buildPreview('b', DEEP, { loadHtml: load, saveImage });
    await buildPreview('b', 'https://open.spotify.com/album/42', { loadHtml: load, saveImage });

    expect(calls).toEqual([DEEP, ROOT, 'https://open.spotify.com/album/42']);
  });

  it('невдалий корінь теж памʼятається — щоб не бити в нього на кожну картку', async () => {
    const { load, calls } = loader(
      { [DEEP]: html(''), 'https://open.spotify.com/x': html('') },
      { [ROOT]: new BlockedUrlError('нема') },
    );
    await buildPreview('b', DEEP, { loadHtml: load, saveImage });
    await buildPreview('b', 'https://open.spotify.com/x', { loadHtml: load, saveImage });

    expect(calls.filter((c) => c === ROOT)).toHaveLength(1);
  });
});
