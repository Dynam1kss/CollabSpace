import { describe, expect, it } from 'vitest';
import { detectInstallPath, pickInstallBanner } from './install-rules';

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
