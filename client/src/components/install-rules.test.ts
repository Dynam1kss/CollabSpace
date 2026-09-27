import { describe, expect, it } from 'vitest';
import { uk } from '../i18n/uk';
import { detectInstallPath, detectPlatform, installTextKey, pickInstallBanner } from './install-rules';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const IPHONE_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_TELEGRAM =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Telegram-Android/11.2.3';
const DESKTOP_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

describe('detectInstallPath', () => {
  it('сафарі на айфоні й айпад під маком — інструкція для ios', () => {
    expect(detectInstallPath(IPHONE_SAFARI, 5)).toBe('ios-safari');
    expect(detectInstallPath(IPAD_AS_MAC, 5)).toBe('ios-safari');
  });

  it('на ios усе, що не сафарі, встановити не може', () => {
    expect(detectInstallPath(IPHONE_CHROME, 5)).toBe('none');
    expect(detectInstallPath(IPHONE_WEBVIEW, 5)).toBe('none');
  });

  it('вбудовані браузери на андроїді — теж ні', () => {
    expect(detectInstallPath(ANDROID_WEBVIEW, 5)).toBe('none');
    expect(detectInstallPath(ANDROID_TELEGRAM, 5)).toBe('none');
  });

  it('хроміум — і на телефоні, і на десктопі (edge теж)', () => {
    expect(detectInstallPath(ANDROID_CHROME, 5)).toBe('chromium');
    expect(detectInstallPath(DESKTOP_EDGE, 0)).toBe('chromium');
  });

  it('справжній мак із сафарі й фаєрфокс — загальна підказка', () => {
    expect(detectInstallPath(IPAD_AS_MAC, 0)).toBe('other');
    expect(detectInstallPath(DESKTOP_FIREFOX, 0)).toBe('other');
  });
});

describe('pickInstallBanner', () => {
  const base = { standalone: false, hasPromptEvent: false };

  it('подія прийшла — кнопка, до неї — підказка з меню', () => {
    expect(pickInstallBanner({ ...base, path: 'chromium' })).toBe('browser-menu');
    expect(pickInstallBanner({ ...base, path: 'chromium', hasPromptEvent: true })).toBe('prompt');
  });

  it('сафарі на ios — інструкція, решта — загальна підказка', () => {
    expect(pickInstallBanner({ ...base, path: 'ios-safari' })).toBe('ios');
    expect(pickInstallBanner({ ...base, path: 'other' })).toBe('generic');
  });

  it('нема як встановити — нічого', () => {
    expect(pickInstallBanner({ ...base, path: 'none' })).toBeNull();
  });

  it('вже встановлено — нічого, навіть із подією', () => {
    expect(pickInstallBanner({ standalone: true, hasPromptEvent: true, path: 'chromium' })).toBeNull();
    expect(pickInstallBanner({ ...base, standalone: true, path: 'ios-safari' })).toBeNull();
  });
});

// увесь шлях, як у плашці: рушій → вид плашки, ОС → текст
function bannerText(ua: string, maxTouchPoints: number) {
  const kind = pickInstallBanner({
    standalone: false,
    hasPromptEvent: false,
    path: detectInstallPath(ua, maxTouchPoints),
  });
  if (kind === null || kind === 'prompt') return kind;
  const key = installTextKey(kind, detectPlatform(ua, maxTouchPoints));
  // перевіряємо на українському тексті — ключ сам по собі нічого не каже
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], uk) as string;
}

describe('detectPlatform', () => {
  it('розпізнає ос, айпад під маком — це ios', () => {
    expect(detectPlatform(ANDROID_CHROME, 5)).toBe('android');
    expect(detectPlatform(IPHONE_SAFARI, 5)).toBe('ios');
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe('ios');
    expect(detectPlatform(MAC_CHROME, 0)).toBe('mac');
    expect(detectPlatform(WINDOWS_CHROME, 0)).toBe('windows');
    expect(detectPlatform(LINUX_CHROME, 0)).toBe('other');
  });
});

describe('текст плашки під ос', () => {
  it('хроміум: андроїд — три крапки й головний екран', () => {
    expect(bannerText(ANDROID_CHROME, 5)).toContain('три крапки у верхньому правому куті');
    expect(bannerText(ANDROID_CHROME, 5)).toContain('«Додати на головний екран»');
  });

  it('хроміум: windows, edge і mac — іконка в адресному рядку, але по-різному', () => {
    const windows = bannerText(WINDOWS_CHROME, 0);
    expect(windows).toContain('зліва від зірочки закладок');
    expect(bannerText(DESKTOP_EDGE, 0)).toBe(windows);
    const mac = bannerText(MAC_CHROME, 0);
    expect(mac).toContain('праворуч в адресному рядку');
    expect(mac).not.toBe(windows);
  });

  it('хроміум на linux/chromeos — загальна підказка з меню', () => {
    expect(bannerText(LINUX_CHROME, 0)).toBe(
      'Відкрийте меню браузера і оберіть «Встановити застосунок» або «Додати на головний екран»',
    );
  });

  it('safari на маку — «Додати в Dock»', () => {
    expect(bannerText(IPAD_AS_MAC, 0)).toContain('«Додати в Dock»');
  });

  it('firefox на windows — обережно й з порадою chrome чи edge', () => {
    const text = bannerText(DESKTOP_FIREFOX, 0);
    expect(text).toContain('може не вміти');
    expect(text).toContain('Chrome чи Edge');
  });

  it('айфон — та сама інструкція «Поділитися», що й була', () => {
    expect(bannerText(IPHONE_SAFARI, 5)).toBe(
      'Щоб встановити застосунок: натисніть «Поділитися», потім «На екран Домівки»',
    );
  });

  it('усі шість — різні', () => {
    const texts = [
      bannerText(ANDROID_CHROME, 5),
      bannerText(WINDOWS_CHROME, 0),
      bannerText(MAC_CHROME, 0),
      bannerText(IPAD_AS_MAC, 0),
      bannerText(DESKTOP_FIREFOX, 0),
      bannerText(IPHONE_SAFARI, 5),
    ];
    expect(new Set(texts).size).toBe(6);
  });

  it('встановити нема як — і далі нічого', () => {
    expect(bannerText(IPHONE_CHROME, 5)).toBeNull();
    expect(bannerText(ANDROID_TELEGRAM, 5)).toBeNull();
  });
});
