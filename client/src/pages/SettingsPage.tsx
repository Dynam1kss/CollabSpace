import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BIO_MAX_LENGTH } from 'shared';
import type { Locale, Theme } from 'shared';
import { changePassword, updateProfile, uploadAvatar } from '../api/profile';
import { errorText } from '../i18n/api-error';
import { applyLocale, applyTheme } from '../prefs';
import { Avatar } from '../components/Avatar';
import { AvatarCropper } from '../components/AvatarCropper';
import { useAuthStore } from '../store/auth-store';

// ті самі межі, що й на сервері: тут — щоб не ганяти 5 МБ заради відмови
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const MIN_PASSWORD = 8;

// назва мови — її ж мовою, не перекладається: людина, що випадково
// перемкнула на незнайому, має впізнати свою
const LANGUAGE_NAMES: Record<Locale, string> = { uk: 'Українська', en: 'English', de: 'Deutsch' };

export function SettingsPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // вибраний файл чекає в кадруванні; на сервер іде лише підтверджений кадр
  const [cropping, setCropping] = useState<File | null>(null);

  const [name, setName] = useState(user?.displayName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [bio, setBio] = useState(user?.bio ?? '');
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioSaved, setBioSaved] = useState(false);

  const [prefsError, setPrefsError] = useState<string | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!user) return null;

  async function handleAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // інакше той самий файл удруге не вибрати — change не спрацює
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setAvatarError(t('errors.UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(t('settings.photoTooBig'));
      return;
    }
    setAvatarError(null);
    // gif кадрування не проходить: через canvas лишився б один кадр, а анімація
    // тут важливіша за точну рамку — вантажимо як є, у кружечках він просто
    // обрізається по центру
    if (file.type === 'image/gif') {
      void handleCropped(file);
      return;
    }
    setCropping(file);
  }

  async function handleCropped(blob: Blob) {
    setCropping(null);
    setUploading(true);
    try {
      setUser((await uploadAvatar(blob)).user);
    } catch (err) {
      setAvatarError(
        errorText(err, t('settings.photoFailed'), { PAYLOAD_TOO_LARGE: t('settings.photoTooBig') }),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleName(e: FormEvent) {
    e.preventDefault();
    setNameSaved(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      setNameError(t('settings.nameInvalid'));
      return;
    }
    try {
      setUser((await updateProfile({ displayName: trimmed })).user);
      setName(trimmed);
      setNameError(null);
      setNameSaved(true);
    } catch (err) {
      setNameError(errorText(err, t('settings.nameFailed'), { VALIDATION_ERROR: t('settings.nameInvalid') }));
    }
  }

  async function handleBio(e: FormEvent) {
    e.preventDefault();
    setBioSaved(false);
    const trimmed = bio.trim();
    if (trimmed.length > BIO_MAX_LENGTH) {
      setBioError(t('settings.bioTooLong', { max: BIO_MAX_LENGTH }));
      return;
    }
    try {
      setUser((await updateProfile({ bio: trimmed })).user);
      setBio(trimmed);
      setBioError(null);
      setBioSaved(true);
    } catch (err) {
      setBioError(
        errorText(err, t('settings.bioFailed'), {
          VALIDATION_ERROR: t('settings.bioTooLong', { max: BIO_MAX_LENGTH }),
        }),
      );
    }
  }

  // тема й мова застосовуються одразу, до відповіді сервера; не зберіглось —
  // вертаємо як було
  async function handleTheme(theme: Theme) {
    if (!user || theme === user.theme) return;
    const previous = user.theme;
    applyTheme(theme);
    setUser({ ...user, theme });
    try {
      setUser((await updateProfile({ theme })).user);
      setPrefsError(null);
    } catch (err) {
      applyTheme(previous);
      setUser({ ...user, theme: previous });
      setPrefsError(errorText(err, t('settings.themeFailed')));
    }
  }

  async function handleLocale(locale: Locale) {
    if (!user || locale === user.locale) return;
    const previous = user.locale;
    applyLocale(locale);
    setUser({ ...user, locale });
    try {
      setUser((await updateProfile({ locale })).user);
      setPrefsError(null);
    } catch (err) {
      applyLocale(previous);
      setUser({ ...user, locale: previous });
      setPrefsError(errorText(err, t('settings.languageFailed')));
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordSaved(false);
    // довжину й збіг ловимо тут, до запиту
    if (next.length < MIN_PASSWORD) {
      setPasswordError(t('settings.passwordTooShort'));
      return;
    }
    if (next !== confirm) {
      setPasswordError(t('settings.passwordMismatch'));
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setPasswordError(null);
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(
        errorText(err, t('settings.passwordFailed'), {
          INVALID_CREDENTIALS: t('settings.wrongCurrentPassword'),
          VALIDATION_ERROR: t('settings.passwordTooShort'),
        }),
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="settings">
      <Link to="/" className="settings-back">
        {t('common.backToBoards')}
      </Link>
      <h1 className="boards-title">{t('settings.title')}</h1>

      <section className="settings-card">
        <h2>{t('settings.photo')}</h2>
        <div className="settings-avatar">
          <Avatar userId={user.id} name={user.displayName} url={user.avatarUrl} size={72} />
          <div className="settings-avatar-actions">
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading
                ? t('settings.uploading')
                : user.avatarUrl
                  ? t('settings.changePhoto')
                  : t('settings.uploadPhoto')}
            </button>
            <span className="board-role">{t('settings.photoHint')}</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            hidden
            aria-label={t('settings.photoFile')}
            onChange={(e) => void handleAvatar(e)}
          />
        </div>
        {avatarError && <p className="form-error">{avatarError}</p>}
        {cropping && (
          <AvatarCropper
            file={cropping}
            onCancel={() => setCropping(null)}
            onConfirm={(blob) => void handleCropped(blob)}
          />
        )}
      </section>

      <section className="settings-card">
        <h2>{t('settings.name')}</h2>
        <form onSubmit={handleName}>
          <label>
            {t('settings.nameLabel')}
            <input
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
            />
          </label>
          {nameError && <p className="form-error">{nameError}</p>}
          {nameSaved && <p className="form-ok">{t('common.saved')}</p>}
          <button type="submit" className="button-primary" disabled={name.trim() === user.displayName}>
            {t('common.save')}
          </button>
        </form>
      </section>

      <section className="settings-card">
        <h2>{t('settings.bio')}</h2>
        <form onSubmit={handleBio}>
          <label>
            {t('settings.bioLabel')}
            <input
              value={bio}
              maxLength={BIO_MAX_LENGTH}
              onChange={(e) => {
                setBio(e.target.value);
                setBioSaved(false);
              }}
            />
          </label>
          <span className="board-role">{t('settings.bioHint', { max: BIO_MAX_LENGTH })}</span>
          {bioError && <p className="form-error">{bioError}</p>}
          {bioSaved && <p className="form-ok">{t('common.saved')}</p>}
          <button type="submit" className="button-primary" disabled={bio.trim() === (user.bio ?? '')}>
            {t('common.save')}
          </button>
        </form>
      </section>

      <section className="settings-card">
        <h2>{t('settings.appearance')}</h2>
        <div className="settings-rows">
          <div className="settings-row">
            <span>{t('settings.theme')}</span>
            <div className="segmented" role="group" aria-label={t('settings.theme')}>
              <button
                type="button"
                aria-pressed={user.theme === 'light'}
                onClick={() => void handleTheme('light')}
              >
                {t('settings.themeLight')}
              </button>
              <button
                type="button"
                aria-pressed={user.theme === 'dark'}
                onClick={() => void handleTheme('dark')}
              >
                {t('settings.themeDark')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>{t('settings.language')}</span>
            <div className="segmented" role="group" aria-label={t('settings.language')}>
              {(Object.keys(LANGUAGE_NAMES) as Locale[]).map((locale) => (
                <button
                  key={locale}
                  type="button"
                  lang={locale}
                  aria-pressed={user.locale === locale}
                  onClick={() => void handleLocale(locale)}
                >
                  {LANGUAGE_NAMES[locale]}
                </button>
              ))}
            </div>
          </div>
        </div>
        {prefsError && <p className="form-error">{prefsError}</p>}
      </section>

      <section className="settings-card">
        <h2>{t('settings.password')}</h2>
        <form onSubmit={handlePassword}>
          <label>
            {t('settings.currentPassword')}
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            {t('settings.newPassword')}
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
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
          {passwordError && <p className="form-error">{passwordError}</p>}
          {passwordSaved && <p className="form-ok">{t('settings.passwordChanged')}</p>}
          <button type="submit" className="button-primary" disabled={savingPassword}>
            {t('settings.changePassword')}
          </button>
        </form>
      </section>
    </div>
  );
}
