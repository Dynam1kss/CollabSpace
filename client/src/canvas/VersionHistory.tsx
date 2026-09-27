import { useEffect, useRef, useState } from 'react';
import type { BoardVersionInfo } from 'shared';
import { fetchVersions, restoreVersion, saveVersion } from '../api/boards';
import { relativeTime } from '../pages/board-card';
import { HistoryIcon } from './icons';
import { useNarrow } from '../use-narrow';
import { useTranslation } from 'react-i18next';
import { dateLocale, i18n } from '../i18n';

// рендериться лише для власника й адміна (див. BoardPage), тож усе керування
// тут без окремих перевірок ролі
interface Props {
  boardId: string;
}

function titleOf(v: BoardVersionInfo) {
  return v.label ?? (v.isManual ? i18n.t('history.manual') : i18n.t('history.auto'));
}

// історія версій дошки. Список тягнемо щоразу на відкриття: він короткий,
// а тримати його живим через сокет заради рідкісного погляду нема сенсу
export function VersionHistory({ boardId }: Props) {
  const { t } = useTranslation();
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<BoardVersionInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // ключ, а не готовий текст: примітка висить, поки панель відкрита, і має
  // перекластись, якщо мову змінять просто зараз
  const [note, setNote] = useState<{ key: string; error: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function reload() {
    try {
      setVersions((await fetchVersions(boardId)).versions);
    } catch {
      setNote({ key: 'history.loadFailed', error: true });
    }
  }

  useEffect(() => {
    if (!open || narrow || busy) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, narrow, busy]);

  function toggleOpen() {
    if (!open) {
      setNote(null);
      void reload();
    }
    setOpen(!open);
  }

  async function handleSave() {
    setBusy('save');
    setNote(null);
    try {
      await saveVersion(boardId, label.trim());
      setLabel('');
      setNote({ key: 'history.saved', error: false });
      await reload();
    } catch {
      setNote({ key: 'history.saveFailed', error: true });
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(v: BoardVersionInfo) {
    // той самий прийом підтвердження, що й на видаленні дошки
    const when = new Date(v.createdAt).toLocaleString(dateLocale(), {
      dateStyle: 'short',
      timeStyle: 'short',
    });
    if (!window.confirm(t('history.confirmRestore', { title: titleOf(v), when }))) {
      return;
    }
    setBusy(v.id);
    setNote(null);
    try {
      await restoreVersion(boardId, v.id);
      setNote({ key: 'history.restored', error: false });
      await reload();
    } catch {
      setNote({ key: 'history.restoreFailed', error: true });
    } finally {
      setBusy(null);
    }
  }

  // глобальні хоткеї полотна пропускають поля вводу, але зупиняємо явно, як у пошуку
  function handleKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !busy) {
      e.preventDefault();
      void handleSave();
    }
  }

  const body = (
    <>
      <div className="history-save">
        <input
          className="search-input"
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('history.labelPlaceholder')}
          aria-label={t('history.labelAria')}
        />
        <button type="button" disabled={!!busy} onClick={() => void handleSave()}>
          {busy === 'save' ? t('history.saving') : t('history.save')}
        </button>
      </div>
      {note && <p className={`export-note${note.error ? ' export-error' : ''}`}>{t(note.key)}</p>}
      {versions === null ? (
        <p className="export-note">{t('common.loading')}</p>
      ) : versions.length === 0 ? (
        <p className="export-note">{t('history.empty')}</p>
      ) : (
        <ul className="history-list">
          {versions.map((v) => (
            <li key={v.id} className={v.isManual ? 'manual' : ''}>
              <div className="history-text">
                <span className="history-title">{titleOf(v)}</span>
                <span className="history-meta">
                  {v.createdByName}, {relativeTime(v.createdAt)}
                </span>
              </div>
              <button type="button" disabled={!!busy} onClick={() => void handleRestore(v)}>
                {busy === v.id ? t('history.restoring') : t('history.restore')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  const toggle = (
    <button
      type="button"
      className={`${narrow ? 'board-island ' : ''}icon-button history-toggle${open ? ' active' : ''}`}
      title={t('history.title')}
      aria-label={t('history.title')}
      aria-expanded={open}
      onClick={toggleOpen}
    >
      <HistoryIcon />
    </button>
  );

  if (narrow) {
    return (
      <>
        {toggle}
        {open && (
          <div className="board-island sheet-full">
            <header className="sheet-head">
              <span>{t('history.title')}</span>
              <button
                type="button"
                className="icon-button"
                title={t('common.close')}
                aria-label={t('common.close')}
                disabled={!!busy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            {body}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="export-group" ref={ref}>
      {toggle}
      {open && <div className="board-island history-popover">{body}</div>}
    </div>
  );
}
