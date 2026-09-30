import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AUTH_CHANGED_KEY, fetchMe } from './api/auth';
import { InstallBanner } from './components/InstallBanner';
import { ProfileCardHost } from './components/ProfileCard';
import { ServerStatus } from './components/ServerStatus';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthStore } from './store/auth-store';
import { applyLocale, applyTheme, THEME_KEY } from './prefs';
import { LOCALE_KEY } from './i18n';
import { LOCALES } from 'shared';
import type { Locale } from 'shared';
import { useTranslation } from 'react-i18next';

// картка й назва застосунку — спільні для входу й реєстрації, самі сторінки
// всередині лишаються тільки формою
function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="auth-card">
      <div className="wordmark">
        <span className="wordmark-dot" />
        CollabSpace
      </div>
      {children}
    </div>
  );
}

function AuthGate() {
  const [view, setView] = useState<'login' | 'register' | 'forgot'>('login');
  return (
    <AuthCard>
      {view === 'login' && (
        <LoginPage
          onSwitchToRegister={() => setView('register')}
          onForgotPassword={() => setView('forgot')}
        />
      )}
      {view === 'register' && <RegisterPage onSwitchToLogin={() => setView('login')} />}
      {view === 'forgot' && <ForgotPasswordPage onBack={() => setView('login')} />}
    </AuthCard>
  );
}

export function App() {
  const { user, status, setUser } = useAuthStore();
  const { t } = useTranslation();

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
        <p>{t('common.loading')}</p>
        <ServerStatus />
      </main>
    );
  }

  return (
    <BrowserRouter>
      {/* одна на застосунок: відкривають її і зі списків, і з полотна */}
      <ProfileCardHost />
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
        {/* посилання з листа відкривають, не входячи — тому поза перевіркою.
        Уже залогіненому теж не заважаємо: пароль він міняє собі ж */}
        <Route
          path="/reset-password"
          element={
            <main className="app-shell auth-shell">
              <AuthCard>
                <ResetPasswordPage />
              </AuthCard>
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
