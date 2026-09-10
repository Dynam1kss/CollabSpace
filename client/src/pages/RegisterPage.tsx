import { useState } from 'react';
import type { FormEvent } from 'react';
import { register } from '../api/auth';
import { useAuthStore } from '../store/auth-store';

interface Props {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: Props) {
  const setUser = useAuthStore((state) => state.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { user } = await register({ email, password, displayName });
      setUser(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка реєстрації');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Реєстрація</h1>
      <label>
        Ім'я
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Пошта
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Пароль
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit">Зареєструватись</button>
      <p>
        Вже є акаунт? <button type="button" onClick={onSwitchToLogin}>Увійти</button>
      </p>
    </form>
  );
}
