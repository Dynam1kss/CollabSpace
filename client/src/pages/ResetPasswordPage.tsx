import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api/auth';
import { errorText } from '../i18n/api-error';

// ті самі 8 символів, що й на сервері та в зміні пароля з налаштувань
const MIN_PASSWORD = 8;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(t('settings.passwordTooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('settings.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ token, password });
      setError(null);
      setDone(true);
    } catch (err) {
      setError(
        errorText(err, t('reset.failed'), {
          RESET_TOKEN_INVALID: t('reset.linkInvalid'),
          VALIDATION_ERROR: t('settings.passwordTooShort'),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  // без токена форму показувати нема сенсу — посилання відкрили без нього
  if (!token) {
    return (
      <div className="auth-done">
        <h1>{t('reset.title')}</h1>
        <p className="form-error">{t('reset.linkInvalid')}</p>
        <button type="button" className="button-primary" onClick={() => void navigate('/')}>
          {t('reset.toLogin')}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="auth-done">
        <h1>{t('reset.title')}</h1>
        <p className="form-ok">{t('reset.done')}</p>
        <button type="button" className="button-primary" onClick={() => void navigate('/')}>
          {t('reset.toLogin')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('reset.title')}</h1>
      <p className="auth-hint">{t('reset.hint')}</p>
      <label>
        {t('settings.newPassword')}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={MIN_PASSWORD}
          required
        />
      </label>
      <label>
        {t('settings.confirmPassword')}
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? t('reset.saving') : t('reset.submit')}
      </button>
    </form>
  );
}
