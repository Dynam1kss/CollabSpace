import { usePresenceStore, otherMembers } from './presence-store';
import { colorForUser, initialsOf } from './presence-colors';

const ROLE_TEXT = {
  OWNER: 'власник',
  EDITOR: 'редактор',
  VIEWER: 'глядач',
};

// хто зараз на дошці, крім мене. Порожній список не ховаємо зовсім — інакше
// незрозуміло, чи я сам, чи індикатор просто не працює
export function Participants() {
  const members = usePresenceStore(otherMembers);

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
