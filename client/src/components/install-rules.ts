// prompt — справжня кнопка (хроміум уже віддав beforeinstallprompt);
// browser-menu — хроміум, але подія ще не прийшла (вона евристична і на
// першому візиті часто мовчить); ios — інструкція для сафарі; generic — решта
export type InstallBannerKind = 'prompt' | 'browser-menu' | 'ios' | 'generic';

// none — встановити нема як узагалі, і тоді плашки не буде
export type InstallPath = 'chromium' | 'ios-safari' | 'other' | 'none';

// ipad з ios 13 прикидається маком — видає себе лише тачем
export function isIos(ua: string, maxTouchPoints: number) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

// вбудовані браузери месенджерів і соцмереж: ні події, ні пункту в меню.
// «; wv)» — голий android webview
const IN_APP = /; wv\)|Telegram|FBAN|FBAV|Instagram|Line\//;

export function detectInstallPath(ua: string, maxTouchPoints: number): InstallPath {
  if (IN_APP.test(ua)) return 'none';
  // на ios ставить на екран лише справжній сафарі. хром, фаєрфокс і т.д. мають
  // свій токен, а вбудовані браузери — голий WKWebView без «Safari/»
  if (isIos(ua, maxTouchPoints)) {
    const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|YaBrowser|DuckDuckGo/.test(ua);
    return safari ? 'ios-safari' : 'none';
  }
  // edge, opera, samsung — теж хроміум і теж мають «Chrome/» у рядку
  if (/Chrome\/|Chromium\//.test(ua)) return 'chromium';
  return 'other';
}

export function pickInstallBanner(opts: {
  standalone: boolean;
  hasPromptEvent: boolean;
  path: InstallPath;
}): InstallBannerKind | null {
  if (opts.standalone) return null;
  if (opts.hasPromptEvent) return 'prompt';
  if (opts.path === 'none') return null;
  if (opts.path === 'chromium') return 'browser-menu';
  if (opts.path === 'ios-safari') return 'ios';
  return 'generic';
}

// ОС окремо від рушія: рушій вирішує, чи можна встановити, а ОС — куди саме
// тиснути. ios перевіряємо раніше за мак — айпад прикидається маком
export type InstallPlatform = 'android' | 'ios' | 'mac' | 'windows' | 'other';

export function detectPlatform(ua: string, maxTouchPoints: number): InstallPlatform {
  if (/Android/.test(ua)) return 'android';
  if (isIos(ua, maxTouchPoints)) return 'ios';
  if (/Mac/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

// для prompt ключа тут нема — там кнопка, і підпис лежить у самій плашці.
// повертає ключ перекладу: правила лишаються чистими й перевіряються без i18n
export function installTextKey(kind: Exclude<InstallBannerKind, 'prompt'>, platform: InstallPlatform) {
  if (kind === 'ios' || platform === 'ios') return 'install.ios';
  if (kind === 'browser-menu') return `install.menu.${platform}`;
  // не хроміум і не сафарі на ios. фаєрфокс на десктопі стандартно сайтів не
  // встановлює — тому обережно і з порадою відкрити в іншому браузері; на мак
  // сюди ж падає й фаєрфокс — звідти хвіст про інший браузер у тексті
  if (platform === 'mac' || platform === 'windows') return `install.generic.${platform}`;
  return 'install.generic.other';
}
