import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AUTH_CHANGED_KEY, fetchMe } from './api/auth';
import { ServerStatus } from './components/ServerStatus';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { useAuthStore } from './store/auth-store';

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

  // storage приходить лише в ІНШІ вкладки. Перезавантаження — найпростіший
  // спосіб перепідключити сокети й скинути стори вже під новою людиною
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === AUTH_CHANGED_KEY) window.location.reload();
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
            <main className={status === 'authenticated' && user ? 'app-shell boards-shell' : 'app-shell auth-shell'}>
              {status === 'authenticated' && user ? <BoardsPage /> : <AuthGate />}
              <ServerStatus />
            </main>
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
