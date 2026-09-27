import { useEffect, useState } from 'react';
import type { BoardInvite } from 'shared';
import { acceptInvite, declineInvite, fetchInvites } from '../api/invites';
import { ROLE_TEXT } from './board-card';

interface Props {
  // після «прийняти» дошка має зʼявитись у списку — його тягне сторінка
  onAccepted: () => void;
}

export function PendingInvites({ onAccepted }: Props) {
  const [invites, setInvites] = useState<BoardInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchInvites()
      .then((data) => setInvites(data.invites))
      .catch(() => setInvites([]));

  useEffect(() => {
    void load();
  }, []);

  async function answer(boardId: string, accept: boolean) {
    setBusyId(boardId);
    try {
      await (accept ? acceptInvite(boardId) : declineInvite(boardId));
      setError(null);
      if (accept) onAccepted();
    } catch (err) {
      // 404 — запрошення вже відкликали, тож просто перечитаємо список
      setError(err instanceof Error ? err.message : 'Не вдалося відповісти на запрошення');
    } finally {
      setBusyId(null);
      void load();
    }
  }

  if (invites.length === 0) return null;

  return (
    <section className="invites">
      <h2 className="invites-title">Запрошення</h2>
      <ul className="invite-list">
        {invites.map((inv) => (
          <li key={inv.boardId}>
            <span className="invite-info">
              <strong>{inv.boardTitle}</strong>
              <span className="board-role">
                {inv.invitedBy
                  ? `Запросив: ${inv.invitedBy.displayName} (${inv.invitedBy.email})`
                  : 'Запросив: акаунт видалено'}
                {' · '}
                {ROLE_TEXT[inv.role]}
              </span>
            </span>
            <span className="invite-actions">
              <button
                type="button"
                className="button-primary"
                disabled={busyId === inv.boardId}
                onClick={() => void answer(inv.boardId, true)}
              >
                Прийняти
              </button>
              <button
                type="button"
                disabled={busyId === inv.boardId}
                onClick={() => void answer(inv.boardId, false)}
              >
                Відхилити
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
