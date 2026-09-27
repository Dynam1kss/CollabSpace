import { useState } from 'react';
import type { FormEvent } from 'react';
import { login } from '../api/auth';
import { useAuthStore } from '../store/auth-store';
import { useTranslation } from 'react-i18next';
import { errorText } from '../i18n/api-error';

interface Props {
  onSwitchToRegister: () => void;
}

export function LoginPage({ onSwitchToRegister }: Props) {
  const { t } = useTranslation();
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
      setError(errorText(err, t('auth.loginFailed')));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('auth.login')}</h1>
      <label>
        {t('auth.email')}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t('auth.password')}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary">
        {t('auth.signIn')}
      </button>
      <p className="auth-switch">
        {t('auth.noAccount')}{' '}
        <button type="button" className="button-link" onClick={onSwitchToRegister}>
          {t('auth.signUp')}
        </button>
      </p>
    </form>
  );
}
