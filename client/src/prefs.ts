import { create } from 'zustand';
import type { Locale, Theme } from 'shared';
import { i18n, LOCALE_KEY, readStoredLocale } from './i18n';

// тема живе в акаунті, але вхід і реєстрація показуються ще до того, як
// акаунт відомий — тому останню застосовану тримаємо й тут, у браузері.
// через цей самий ключ про зміну дізнаються інші вкладки (подія storage)
export const THEME_KEY = 'collabspace:theme';

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface PrefsState {
  theme: Theme;
  locale: Locale;
}

export const usePrefsStore = create<PrefsState>(() => ({
  theme: readStoredTheme(),
  locale: readStoredLocale(),
}));

// атрибут на <html> перемикає css-змінні, стор — полотно (konva змінних не читає)
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  if (usePrefsStore.getState().theme !== theme) usePrefsStore.setState({ theme });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // приватне вікно — інші вкладки просто не дізнаються
  }
}

// i18next сам перемальовує все, що читає тексти через useTranslation; lang на
// <html> — для скрінрідерів і для переносів слів
export function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  if (usePrefsStore.getState().locale !== locale) usePrefsStore.setState({ locale });
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // приватне вікно — інші вкладки просто не дізнаються
  }
}
