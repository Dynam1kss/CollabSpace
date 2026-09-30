import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { resendVerification } from '../api/auth';
import { errorText } from '../i18n/api-error';
import { useAuthStore } from '../store/auth-store';

// сховали — до кінця вкладки. sessionStorage, а не localStorage: нагадування
// має вернутись наступного разу, поки пошта не підтверджена, інакше воно
// зникає назавжди з першого ж кліку
const DISMISS_KEY = 'collabspace:verify-hidden';

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function VerifyEmailBanner() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [hidden, setHidden] = useState(readDismissed);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || user.emailVerified || hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // приватне вікно — просто сховається до перезавантаження
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    try {
      await resendVerification();
      setSent(true);
    } catch (err) {
      // мовчазна відмова тут найгірша: людина тисне ще раз і не розуміє,
      // чому нічого не приходить. Найчастіше це якраз ліміт
      setError(errorText(err, t('verify.failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="verify-banner">
      <span className="verify-banner-text">
        {error ?? (sent ? t('verify.resent') : t('verify.reminder', { email: user.email }))}
      </span>
      {!sent && !error && (
        <button type="button" className="button-link" disabled={busy} onClick={() => void handleResend()}>
          {busy ? t('verify.sending') : t('verify.resend')}
        </button>
      )}
      <button
        type="button"
        className="icon-button verify-banner-close"
        title={t('common.close')}
        aria-label={t('common.close')}
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
