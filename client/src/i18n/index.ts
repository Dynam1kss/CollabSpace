import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from 'shared';
import { LOCALES } from 'shared';
import { de } from './de';
import { en } from './en';
import { uk } from './uk';

// мова, як і тема, живе в акаунті, але до входу її ще нема звідки взяти —
// тож остання застосована лежить і в браузері. той самий ключ бачать інші вкладки
export const LOCALE_KEY = 'collabspace:locale';

export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    return LOCALES.includes(stored as Locale) ? (stored as Locale) : 'uk';
  } catch {
    return 'uk';
  }
}

// для дат і часу: en — британський порядок день.місяць, як і в решти
export const DATE_LOCALE: Record<Locale, string> = { uk: 'uk-UA', en: 'en-GB', de: 'de-DE' };

export function dateLocale() {
  return DATE_LOCALE[(i18n.language as Locale) ?? 'uk'] ?? 'uk-UA';
}

void i18n.use(initReactI18next).init({
  resources: { uk: { translation: uk }, en: { translation: en }, de: { translation: de } },
  lng: readStoredLocale(),
  fallbackLng: 'uk',
  // react сам екранує, подвійне екранування ламало б лапки й апострофи
  interpolation: { escapeValue: false },
  // ресурси вбудовані — ініціалізація синхронна, перший рендер уже перекладений
  initAsync: false,
});

export { i18n };
