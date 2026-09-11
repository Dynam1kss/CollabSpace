import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { fetchMe } from './api/auth';
import { ServerStatus } from './components/ServerStatus';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { useAuthStore } from './store/auth-store';

function AuthGate() {
  const [view, setView] = useState<'login' | 'register'>('login');
  return view === 'login' ? (
    <LoginPage onSwitchToRegister={() => setView('register')} />
  ) : (
    <RegisterPage onSwitchToLogin={() => setView('login')} />
  );
}

export function App() {
  const { user, status, setUser } = useAuthStore();

  useEffect(() => {
    fetchMe()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, [setUser]);

  if (status === 'loading') {
    return (
      <main className="app-shell">
        <ServerStatus />
        <p>Завантаження…</p>
      </main>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <main className="app-shell">
              <ServerStatus />
              {status === 'authenticated' && user ? <BoardsPage /> : <AuthGate />}
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
