import { useState } from 'react';
import { usePresenceStore, otherMembers } from './presence-store';
import { colorForUser, initialsOf } from './presence-colors';
import { PeopleIcon } from './icons';
import { useNarrow } from '../use-narrow';
import { useTranslation } from 'react-i18next';

// хто зараз на дошці, крім мене. Порожній список не ховаємо зовсім — інакше
// незрозуміло, чи я сам, чи індикатор просто не працює.
// На телефоні кружечки в рядок не влізуть — там це кнопка з лічильником,
// яка відкриває список на весь екран (і заразом показує ролі текстом,
// бо title на тачі ніхто не побачить)
export function Participants() {
  const { t } = useTranslation();
  const members = usePresenceStore(otherMembers);
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);

  if (!narrow) {
    return (
      <div className="board-island participants">
        {members.length === 0 ? (
          <span className="participants-empty">{t('participants.alone')}</span>
        ) : (
          members.map((member) => (
            <span
              key={member.clientId}
              className="participant"
              style={{ background: colorForUser(member.userId) }}
              title={t('participants.memberRole', {
                name: member.displayName,
                role: t(`roles.${member.role}`),
              })}
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
        title={t('participants.who')}
        aria-label={t('participants.who')}
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
        <span>{t('participants.title')}</span>
        <button
          type="button"
          className="icon-button"
          title={t('common.close')}
          aria-label={t('common.close')}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </header>
      <ul className="sheet-list">
        {members.length === 0 && <li className="participants-empty">{t('participants.alone')}</li>}
        {members.map((member) => (
          <li key={member.clientId}>
            <span className="participant" style={{ background: colorForUser(member.userId) }}>
              {initialsOf(member.displayName)}
            </span>
            <span className="member-who">{member.displayName}</span>
            <span className="board-role">{t(`roles.${member.role}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
