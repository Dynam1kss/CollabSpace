import { useEffect, useState } from 'react';
import { fetchMe } from './api/auth';
import { ServerStatus } from './components/ServerStatus';
import { BoardsPage } from './pages/BoardsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { useAuthStore } from './store/auth-store';

export function App() {
  const { user, status, setUser } = useAuthStore();
  const [view, setView] = useState<'login' | 'register'>('login');

  useEffect(() => {
    fetchMe()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, [setUser]);

  return (
    <main>
      <ServerStatus />
      {status === 'loading' && <p>Завантаження…</p>}
      {status === 'authenticated' && user && <BoardsPage />}
      {status === 'guest' &&
        (view === 'login' ? (
          <LoginPage onSwitchToRegister={() => setView('register')} />
        ) : (
          <RegisterPage onSwitchToLogin={() => setView('login')} />
        ))}
    </main>
  );
}
