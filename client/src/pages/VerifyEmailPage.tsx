import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMe, resendVerification, verifyEmail } from '../api/auth';
import { errorText } from '../i18n/api-error';
import { useAuthStore } from '../store/auth-store';

type State = 'working' | 'done' | 'failed';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token') ?? '';
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [state, setState] = useState<State>(token ? 'working' : 'failed');
  const [error, setError] = useState<string | null>(token ? null : t('verify.linkInvalid'));
  const [resent, setResent] = useState(false);
  // react у строгому режимі монтує двічі, а токен одноразовий — другий запит
  // отримав би «вже використане» і показав помилку замість успіху
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verifyEmail({ token })
      .then(async () => {
        setState('done');
        // значок у шапці й нагадування залежать від emailVerified — перечитуємо
        await fetchMe()
          .then((data) => setUser(data.user))
          .catch(() => {});
      })
      .catch((err) => {
        setState('failed');
        setError(errorText(err, t('verify.failed'), { VERIFY_TOKEN_INVALID: t('verify.linkInvalid') }));
      });
    // t навмисно поза залежностями: інакше зміна мови повторила б запит
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, setUser]);

  async function handleResend() {
    try {
      await resendVerification();
      setResent(true);
    } catch (err) {
      setError(errorText(err, t('verify.failed')));
    }
  }

  return (
    <div className="auth-done">
      <h1>{t('verify.title')}</h1>
      {state === 'working' && <p className="auth-hint">{t('verify.working')}</p>}
      {state === 'done' && <p className="form-ok">{t('verify.done')}</p>}
      {state === 'failed' && <p className="form-error">{error}</p>}
      {/* новий лист просити нема кому, поки людина не в своєму акаунті */}
      {state === 'failed' && user && !user.emailVerified && !resent && (
        <button type="button" className="button-primary" onClick={() => void handleResend()}>
          {t('verify.resend')}
        </button>
      )}
      {resent && <p className="form-ok">{t('verify.resent')}</p>}
      <button type="button" className="button-link" onClick={() => void navigate('/')}>
        {t('verify.toBoards')}
      </button>
    </div>
  );
}
