import { useState } from 'react';
import { usePresenceStore, otherMembers } from './presence-store';
import { colorForUser, initialsOf } from './presence-colors';
import { PeopleIcon } from './icons';
import { useNarrow } from '../use-narrow';

const ROLE_TEXT = {
  OWNER: 'власник',
  ADMIN: 'адміністратор',
  EDITOR: 'редактор',
  VIEWER: 'глядач',
};

// хто зараз на дошці, крім мене. Порожній список не ховаємо зовсім — інакше
// незрозуміло, чи я сам, чи індикатор просто не працює.
// На телефоні кружечки в рядок не влізуть — там це кнопка з лічильником,
// яка відкриває список на весь екран (і заразом показує ролі текстом,
// бо title на тачі ніхто не побачить)
export function Participants() {
  const members = usePresenceStore(otherMembers);
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);

  if (!narrow) {
    return (
      <div className="board-island participants">
        {members.length === 0 ? (
          <span className="participants-empty">сам на дошці</span>
        ) : (
          members.map((member) => (
            <span
              key={member.clientId}
              className="participant"
              style={{ background: colorForUser(member.userId) }}
              title={`${member.displayName} — ${ROLE_TEXT[member.role]}`}
            >
              {initialsOf(member.displayName)}
            </span>
          ))
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="board-island participants participants-toggle"
        title="Хто на дошці"
        aria-label="Хто на дошці"
        onClick={() => setOpen(true)}
      >
        <PeopleIcon />
        <span className="participants-count">{members.length + 1}</span>
      </button>
    );
  }

  return (
    <div className="board-island sheet-full">
      <header className="sheet-head">
        <span>На дошці</span>
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
      <ul className="sheet-list">
        {members.length === 0 && <li className="participants-empty">сам на дошці</li>}
        {members.map((member) => (
          <li key={member.clientId}>
            <span className="participant" style={{ background: colorForUser(member.userId) }}>
              {initialsOf(member.displayName)}
            </span>
            <span className="member-who">{member.displayName}</span>
            <span className="board-role">{ROLE_TEXT[member.role]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
