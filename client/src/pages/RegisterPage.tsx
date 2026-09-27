import { useState } from 'react';
import type { FormEvent } from 'react';
import { register } from '../api/auth';
import { useAuthStore } from '../store/auth-store';
import { useTranslation } from 'react-i18next';
import { errorText } from '../i18n/api-error';

interface Props {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: Props) {
  const { t } = useTranslation();
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
      setError(errorText(err, t('auth.registerFailed')));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('auth.register')}</h1>
      <label>
        {t('auth.name')}
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        {t('auth.email')}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        {t('auth.password')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary">
        {t('auth.signUp')}
      </button>
      <p className="auth-switch">
        {t('auth.haveAccount')}{' '}
        <button type="button" className="button-link" onClick={onSwitchToLogin}>
          {t('auth.signIn')}
        </button>
      </p>
    </form>
  );
}
