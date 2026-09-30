import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { forgotPassword } from '../api/auth';
import { errorText } from '../i18n/api-error';

interface Props {
  onBack: () => void;
}

export function ForgotPasswordPage({ onBack }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(errorText(err, t('forgot.failed')));
    } finally {
      setBusy(false);
    }
  };

  // текст той самий і для зареєстрованої пошти, і для будь-якої іншої —
  // інакше форма стала б перевіркою, хто в нас є
  if (sent) {
    return (
      <div className="auth-done">
        <h1>{t('forgot.title')}</h1>
        <p className="form-ok">{t('forgot.sent')}</p>
        <p className="auth-switch">
          <button type="button" className="button-link" onClick={onBack}>
            {t('forgot.backToLogin')}
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>{t('forgot.title')}</h1>
      <p className="auth-hint">{t('forgot.hint')}</p>
      <label>
        {t('auth.email')}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="button-primary" disabled={busy}>
        {busy ? t('forgot.sending') : t('forgot.send')}
      </button>
      <p className="auth-switch">
        <button type="button" className="button-link" onClick={onBack}>
          {t('forgot.backToLogin')}
        </button>
      </p>
    </form>
  );
}
