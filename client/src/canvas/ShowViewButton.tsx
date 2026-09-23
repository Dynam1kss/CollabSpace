import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronIcon, ShowViewIcon } from './icons';
import { otherMembers, usePresenceStore } from './presence-store';
import { loadShowViewTargets, saveShowViewTargets } from './show-view-targets';
import type { ShowViewTargets } from './show-view-targets';
import { useNarrow } from '../use-narrow';

// скільки кнопка світиться «надіслано»: усе видиме відбувається в чужих
// вкладках, без цього натискання виглядає так, ніби нічого не сталось
const FLASH_MS = 1200;

interface Props {
  boardId: string;
  currentUserId: string;
  // undefined — усій кімнаті, список — лише цим userId
  onShare: (targets?: string[]) => void;
}

// «показати всім мій вид» плюс вибір адресатів поруч. Натискання самої
// кнопки шле одразу по тому, що вибрано минулого разу — відкривати список
// щоразу посеред обговорення нікому не треба
export function ShowViewButton({ boardId, currentUserId, onShare }: Props) {
  const narrow = useNarrow();
  const members = usePresenceStore(otherMembers);
  // читаємо сховище один раз на монтування; інша дошка — інший key у
  // BoardPage, тобто новий компонент і новий вибір
  const [targets, setTargets] = useState<ShowViewTargets>(() => loadShowViewTargets(boardId, currentUserId));
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [sent]);

  // закриття по кліку повз — тим самим прийомом, що палітра й пошук
  useEffect(() => {
    if (!open || narrow) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, narrow]);

  // одна людина може сидіти з двох вкладок — у списку вона має бути одна,
  // тому зводимо присутніх за userId
  const people = useMemo(() => {
    const byUser = new Map<string, string>();
    for (const m of members) {
      if (m.userId !== currentUserId) byUser.set(m.userId, m.displayName);
    }
    return [...byUser].map(([userId, displayName]) => ({ userId, displayName }));
  }, [members, currentUserId]);

  function apply(next: ShowViewTargets) {
    setTargets(next);
    saveShowViewTargets(boardId, currentUserId, next);
  }

  function toggle(userId: string) {
    const current = targets === 'all' ? [] : targets;
    const next = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId];
    // зняли останню галочку — це знову «усім», порожній вибір нікому нічого не шле
    apply(next.length === 0 ? 'all' : next);
  }

  function share() {
    onShare(targets === 'all' ? undefined : targets);
    setSent(true);
  }

  const label = targets === 'all' ? 'Показати всім мій вид' : `Показати мій вид (${targets.length})`;

  const list = (
    <ul className="show-view-list">
      <li>
        <label>
          <input type="checkbox" checked={targets === 'all'} onChange={() => apply('all')} />
          <span>Усім</span>
        </label>
      </li>
      {people.map((p) => (
        <li key={p.userId}>
          <label>
            <input
              type="checkbox"
              checked={targets !== 'all' && targets.includes(p.userId)}
              onChange={() => toggle(p.userId)}
            />
            <span>{p.displayName}</span>
          </label>
        </li>
      ))}
      {people.length === 0 && <li className="show-view-empty">на дошці більше нікого</li>}
    </ul>
  );

  const mainButton = (
    <button
      type="button"
      className={`${narrow ? 'board-island ' : ''}icon-button show-view${sent ? ' sent' : ''}`}
      title={label}
      aria-label={label}
      onClick={share}
    >
      <ShowViewIcon />
    </button>
  );

  const pickButton = (
    <button
      type="button"
      className={`${narrow ? 'board-island ' : ''}icon-button show-view-pick${open ? ' active' : ''}`}
      title="Кому показувати"
      aria-label="Кому показувати"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <ChevronIcon />
    </button>
  );

  // на телефоні попап поруч із вузькою колонкою не влазить — там та сама
  // повноекранна накладка, що в пошуку й присутніх
  if (narrow) {
    return (
      <>
        {mainButton}
        {pickButton}
        {open && (
          <div className="board-island sheet-full">
            <header className="sheet-head">
              <span>Кому показувати</span>
              <button
                type="button"
                className="icon-button"
                title="Закрити"
                aria-label="Закрити"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            {list}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="show-view-group" ref={ref}>
      {mainButton}
      {pickButton}
      {open && <div className="board-island show-view-popover">{list}</div>}
    </div>
  );
}
