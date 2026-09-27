import { create } from 'zustand';
import type { Theme } from 'shared';

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
}

export const usePrefsStore = create<PrefsState>(() => ({ theme: readStoredTheme() }));

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
