import { useEffect, useRef, useState } from 'react';
import type { BoardVersionInfo } from 'shared';
import { fetchVersions, restoreVersion, saveVersion } from '../api/boards';
import { relativeTime } from '../pages/board-card';
import { HistoryIcon } from './icons';
import { useNarrow } from '../use-narrow';

// рендериться лише для власника й адміна (див. BoardPage), тож усе керування
// тут без окремих перевірок ролі
interface Props {
  boardId: string;
}

function titleOf(v: BoardVersionInfo) {
  return v.label ?? (v.isManual ? 'Збережена версія' : 'Автозбереження');
}

// історія версій дошки. Список тягнемо щоразу на відкриття: він короткий,
// а тримати його живим через сокет заради рідкісного погляду нема сенсу
export function VersionHistory({ boardId }: Props) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<BoardVersionInfo[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function reload() {
    try {
      setVersions((await fetchVersions(boardId)).versions);
    } catch {
      setNote({ text: 'Не вдалося завантажити історію', error: true });
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
      setNote({ text: 'Версію збережено', error: false });
      await reload();
    } catch {
      setNote({ text: 'Не вдалося зберегти версію', error: true });
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(v: BoardVersionInfo) {
    // той самий прийом підтвердження, що й на видаленні дошки
    const when = new Date(v.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
    if (
      !window.confirm(
        `Відкотити дошку до «${titleOf(v)}» (${when})? Вміст зміниться у всіх, хто зараз на дошці.`,
      )
    ) {
      return;
    }
    setBusy(v.id);
    setNote(null);
    try {
      await restoreVersion(boardId, v.id);
      setNote({ text: 'Дошку відкочено. Попередній стан — окремим автозбереженням угорі', error: false });
      await reload();
    } catch {
      setNote({ text: 'Не вдалося відкотити', error: true });
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
          placeholder="Підпис (необовʼязково)"
          aria-label="Підпис версії"
        />
        <button type="button" disabled={!!busy} onClick={() => void handleSave()}>
          {busy === 'save' ? 'Зберігаю…' : 'Зберегти версію'}
        </button>
      </div>
      {note && <p className={`export-note${note.error ? ' export-error' : ''}`}>{note.text}</p>}
      {versions === null ? (
        <p className="export-note">Завантаження…</p>
      ) : versions.length === 0 ? (
        <p className="export-note">Версій ще нема — перша зʼявиться під час роботи з дошкою</p>
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
                {busy === v.id ? 'Відкочую…' : 'Відкотити'}
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
      title="Історія версій"
      aria-label="Історія версій"
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
              <span>Історія версій</span>
              <button
                type="button"
                className="icon-button"
                title="Закрити"
                aria-label="Закрити"
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
