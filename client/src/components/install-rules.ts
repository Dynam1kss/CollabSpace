export type InstallBannerKind = 'prompt' | 'ios';

// після «закрити» не набридаємо два тижні
export const INSTALL_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

export function isDismissedRecently(dismissedAt: number | null, now: number) {
  return dismissedAt !== null && now - dismissedAt < INSTALL_DISMISS_MS;
}

// ipad з ios 13 прикидається маком — видає себе лише тачем
export function isIos(ua: string, maxTouchPoints: number) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

// на ios ставить на екран лише справжній сафарі. хром, фаєрфокс і т.д. мають
// свій токен, а вбудовані браузери (телеграм і ко) — голий WKWebView без «Safari/»
export function isIosSafari(ua: string, maxTouchPoints: number) {
  return (
    isIos(ua, maxTouchPoints) &&
    /Safari\//.test(ua) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|YaBrowser|DuckDuckGo|Telegram/.test(ua)
  );
}

export function pickInstallBanner(opts: {
  standalone: boolean;
  dismissed: boolean;
  hasPromptEvent: boolean;
  iosSafari: boolean;
}): InstallBannerKind | null {
  if (opts.standalone || opts.dismissed) return null;
  if (opts.hasPromptEvent) return 'prompt';
  if (opts.iosSafari) return 'ios';
  return null;
}
