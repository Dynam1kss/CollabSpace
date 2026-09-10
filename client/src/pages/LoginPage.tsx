import { useState } from 'react';
import type { FormEvent } from 'react';
import { login } from '../api/auth';
import { useAuthStore } from '../store/auth-store';

interface Props {
  onSwitchToRegister: () => void;
}

export function LoginPage({ onSwitchToRegister }: Props) {
  const setUser = useAuthStore((state) => state.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { user } = await login({ email, password });
      setUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка входу');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Вхід</h1>
      <label>
        Пошта
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Пароль
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit">Увійти</button>
      <p>
        Немає акаунту? <button type="button" onClick={onSwitchToRegister}>Зареєструватись</button>
      </p>
    </form>
  );
}
