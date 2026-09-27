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

const IOS_TEXT = 'Щоб встановити застосунок: натисніть «Поділитися», потім «На екран Домівки»';

// хроміум, але beforeinstallprompt ще не прийшов — показуємо, де пункт у меню
const BROWSER_MENU_TEXT: Record<InstallPlatform, string> = {
  android:
    'Відкрийте меню браузера (три крапки у верхньому правому куті) і оберіть «Додати на головний екран»',
  windows:
    'Натисніть іконку встановлення в адресному рядку (зліва від зірочки закладок) або відкрийте меню (три крапки) → «Встановити CollabSpace»',
  mac: 'Натисніть іконку встановлення праворуч в адресному рядку або відкрийте меню браузера (три крапки) → «Встановити CollabSpace»',
  ios: IOS_TEXT,
  other: 'Відкрийте меню браузера і оберіть «Встановити застосунок» або «Додати на головний екран»',
};

// не хроміум і не сафарі на ios. фаєрфокс на десктопі стандартно сайтів не
// встановлює — тому обережно і з порадою відкрити в іншому браузері
const GENERIC_TEXT: Record<InstallPlatform, string> = {
  // сюди ж падає й фаєрфокс на маку — тому хвіст про інший браузер
  mac: 'У Safari: меню «Файл» → «Додати в Dock» або кнопка «Поділитися» → «Додати в Dock». В іншому браузері відкрийте CollabSpace у Safari чи Chrome',
  windows:
    'Цей браузер може не вміти встановлювати застосунки — пошукайте «Встановити» в його меню або відкрийте CollabSpace у Chrome чи Edge',
  android:
    'CollabSpace можна встановити як застосунок — пошукайте в меню браузера «Встановити» чи «Додати на головний екран»',
  ios: IOS_TEXT,
  other:
    'CollabSpace можна встановити як застосунок — пошукайте в меню браузера «Встановити» чи «Додати на головний екран»',
};

// для prompt тексту тут нема — там кнопка, і підпис лежить у самій плашці
export function installText(kind: Exclude<InstallBannerKind, 'prompt'>, platform: InstallPlatform) {
  if (kind === 'ios') return IOS_TEXT;
  if (kind === 'browser-menu') return BROWSER_MENU_TEXT[platform];
  return GENERIC_TEXT[platform];
}
