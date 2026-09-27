import { describe, expect, it } from 'vitest';
import { INSTALL_DISMISS_MS, isDismissedRecently, isIosSafari, pickInstallBanner } from './install-rules';

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

describe('isIosSafari', () => {
  it('справжній сафарі на айфоні', () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
  });

  it('хром на ios і вбудований браузер — ні', () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(IPHONE_WEBVIEW, 5)).toBe(false);
  });

  it('айпад під маком розпізнається по тачу, справжній мак — ні', () => {
    expect(isIosSafari(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIosSafari(IPAD_AS_MAC, 0)).toBe(false);
  });

  it('андроїд — не ios', () => {
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe('pickInstallBanner', () => {
  const base = { standalone: false, dismissed: false, hasPromptEvent: false, iosSafari: false };

  it('є подія встановлення — кнопка', () => {
    expect(pickInstallBanner({ ...base, hasPromptEvent: true })).toBe('prompt');
  });

  it('сафарі на ios — інструкція', () => {
    expect(pickInstallBanner({ ...base, iosSafari: true })).toBe('ios');
  });

  it('ні події, ні сафарі — нічого', () => {
    expect(pickInstallBanner(base)).toBeNull();
  });

  it('вже встановлено або закрито — нічого', () => {
    expect(pickInstallBanner({ ...base, hasPromptEvent: true, standalone: true })).toBeNull();
    expect(pickInstallBanner({ ...base, iosSafari: true, dismissed: true })).toBeNull();
  });
});

describe('isDismissedRecently', () => {
  it('тримає паузу після закриття і потім відпускає', () => {
    const now = 1_000_000_000_000;
    expect(isDismissedRecently(null, now)).toBe(false);
    expect(isDismissedRecently(now - 1000, now)).toBe(true);
    expect(isDismissedRecently(now - INSTALL_DISMISS_MS - 1, now)).toBe(false);
  });
});
