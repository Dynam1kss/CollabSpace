import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { changePassword, updateDisplayName, uploadAvatar } from '../api/profile';
import { Avatar } from '../components/Avatar';
import { useAuthStore } from '../store/auth-store';

// ті самі межі, що й на сервері: тут — щоб не ганяти 5 МБ заради відмови
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const MIN_PASSWORD = 8;

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState(user?.displayName ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

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
      setAvatarError('Підтримуються лише PNG, JPEG, WebP і GIF');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('Файл завеликий — до 5 МБ');
      return;
    }
    setUploading(true);
    setAvatarError(null);
    try {
      setUser((await uploadAvatar(file)).user);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Не вдалося завантажити фото');
    } finally {
      setUploading(false);
    }
  }

  async function handleName(e: FormEvent) {
    e.preventDefault();
    setNameSaved(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      setNameError('Імʼя має бути від 1 до 100 символів');
      return;
    }
    try {
      setUser((await updateDisplayName(trimmed)).user);
      setName(trimmed);
      setNameError(null);
      setNameSaved(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Не вдалося зберегти імʼя');
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordSaved(false);
    // довжину й збіг ловимо тут, до запиту
    if (next.length < MIN_PASSWORD) {
      setPasswordError('Новий пароль має бути щонайменше 8 символів');
      return;
    }
    if (next !== confirm) {
      setPasswordError('Нові паролі не збігаються');
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
      setPasswordError(err instanceof Error ? err.message : 'Не вдалося змінити пароль');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="settings">
      <Link to="/" className="settings-back">
        ← До списку дошок
      </Link>
      <h1 className="boards-title">Налаштування</h1>

      <section className="settings-card">
        <h2>Фото</h2>
        <div className="settings-avatar">
          <Avatar userId={user.id} name={user.displayName} url={user.avatarUrl} size={72} />
          <div className="settings-avatar-actions">
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Завантаження…' : user.avatarUrl ? 'Змінити фото' : 'Завантажити фото'}
            </button>
            <span className="board-role">PNG, JPEG, WebP або GIF, до 5 МБ</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            hidden
            aria-label="Файл фото"
            onChange={(e) => void handleAvatar(e)}
          />
        </div>
        {avatarError && <p className="form-error">{avatarError}</p>}
      </section>

      <section className="settings-card">
        <h2>Імʼя</h2>
        <form onSubmit={handleName}>
          <label>
            Як вас бачать інші
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
          {nameSaved && <p className="form-ok">Збережено</p>}
          <button type="submit" className="button-primary" disabled={name.trim() === user.displayName}>
            Зберегти
          </button>
        </form>
      </section>

      <section className="settings-card">
        <h2>Пароль</h2>
        <form onSubmit={handlePassword}>
          <label>
            Поточний пароль
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            Новий пароль
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>
          <label>
            Новий пароль ще раз
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          {passwordError && <p className="form-error">{passwordError}</p>}
          {passwordSaved && <p className="form-ok">Пароль змінено</p>}
          <button type="submit" className="button-primary" disabled={savingPassword}>
            Змінити пароль
          </button>
        </form>
      </section>
    </div>
  );
}
