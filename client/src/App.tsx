import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AUTH_CHANGED_KEY, fetchMe } from './api/auth';
import { InstallBanner } from './components/InstallBanner';
import { ServerStatus } from './components/ServerStatus';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthStore } from './store/auth-store';
import { applyLocale, applyTheme, THEME_KEY } from './prefs';
import { LOCALE_KEY } from './i18n';
import { LOCALES } from 'shared';
import type { Locale } from 'shared';

// картка й назва застосунку — спільні для входу й реєстрації, самі сторінки
// всередині лишаються тільки формою
function AuthGate() {
  const [view, setView] = useState<'login' | 'register'>('login');
  return (
    <div className="auth-card">
      <div className="wordmark">
        <span className="wordmark-dot" />
        CollabSpace
      </div>
      {view === 'login' ? (
        <LoginPage onSwitchToRegister={() => setView('register')} />
      ) : (
        <RegisterPage onSwitchToLogin={() => setView('login')} />
      )}
    </div>
  );
}

export function App() {
  const { user, status, setUser } = useAuthStore();

  useEffect(() => {
    fetchMe()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, [setUser]);

  // тема з акаунта перекриває ту, що лишилась у браузері від попереднього входу
  const accountTheme = user?.theme;
  useEffect(() => {
    if (accountTheme) applyTheme(accountTheme);
  }, [accountTheme]);

  const accountLocale = user?.locale;
  useEffect(() => {
    if (accountLocale) applyLocale(accountLocale);
  }, [accountLocale]);

  // storage приходить лише в ІНШІ вкладки. Перезавантаження — найпростіший
  // спосіб перепідключити сокети й скинути стори вже під новою людиною
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === AUTH_CHANGED_KEY) window.location.reload();
      // тему перемкнули в іншій вкладці — підхоплюємо без перезавантаження
      if (e.key === THEME_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        const theme = e.newValue;
        applyTheme(theme);
        const current = useAuthStore.getState().user;
        if (current) useAuthStore.getState().setUser({ ...current, theme });
      }
      if (e.key === LOCALE_KEY && LOCALES.includes(e.newValue as Locale)) {
        const locale = e.newValue as Locale;
        applyLocale(locale);
        const current = useAuthStore.getState().user;
        if (current) useAuthStore.getState().setUser({ ...current, locale });
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (status === 'loading') {
    return (
      <main className="app-shell auth-shell">
        <p>Завантаження…</p>
        <ServerStatus />
      </main>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <main
              className={
                status === 'authenticated' && user ? 'app-shell boards-shell' : 'app-shell auth-shell'
              }
            >
              {status === 'authenticated' && user ? <BoardsPage /> : <AuthGate />}
              {/* під формою, а не над нею — щоб ніколи не заступала вхід */}
              <InstallBanner />
              <ServerStatus />
            </main>
          }
        />
        <Route
          path="/settings"
          element={
            status === 'authenticated' ? (
              <main className="app-shell settings-shell">
                <SettingsPage />
              </main>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/boards/:id"
          element={status === 'authenticated' ? <BoardPage /> : <Navigate to="/" replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}
