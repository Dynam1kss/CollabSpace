import { useEffect, useState } from 'react';
import type { BoardInvite } from 'shared';
import { Avatar } from '../components/Avatar';
import { acceptInvite, declineInvite, fetchInvites } from '../api/invites';
import { usePoll } from '../use-poll';
import { LISTS_POLL_MS } from './board-card';
import { useTranslation } from 'react-i18next';
import { errorText } from '../i18n/api-error';

interface Props {
  // після «прийняти» дошка має зʼявитись у списку — його тягне сторінка
  onAccepted: () => void;
}

export function PendingInvites({ onAccepted }: Props) {
  const { t } = useTranslation();
  const [invites, setInvites] = useState<BoardInvite[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchInvites()
      .then((data) => setInvites(data.invites))
      // мережа блимнула — лишаємо те, що вже показано
      .catch(() => {});

  useEffect(() => {
    void load();
  }, []);

  usePoll(() => void load(), LISTS_POLL_MS);

  async function answer(boardId: string, accept: boolean) {
    setBusyId(boardId);
    try {
      await (accept ? acceptInvite(boardId) : declineInvite(boardId));
      setError(null);
      if (accept) onAccepted();
    } catch (err) {
      // 404 — запрошення вже відкликали, тож просто перечитаємо список
      setError(errorText(err, t('invites.answerFailed')));
    } finally {
      setBusyId(null);
      void load();
    }
  }

  if (invites.length === 0) return null;

  return (
    <section className="invites">
      <h2 className="invites-title">{t('invites.title')}</h2>
      <ul className="invite-list">
        {invites.map((inv) => (
          <li key={inv.boardId}>
            {inv.invitedBy && (
              <Avatar
                userId={inv.invitedBy.userId}
                name={inv.invitedBy.displayName}
                url={inv.invitedBy.avatarUrl}
                size={36}
              />
            )}
            <span className="invite-info">
              <strong>{inv.boardTitle}</strong>
              <span className="board-role">
                {inv.invitedBy
                  ? t('invites.invitedBy', { name: inv.invitedBy.displayName, email: inv.invitedBy.email })
                  : t('invites.invitedByDeleted')}
                {' · '}
                {t(`roles.${inv.role}`)}
              </span>
            </span>
            <span className="invite-actions">
              <button
                type="button"
                className="button-primary"
                disabled={busyId === inv.boardId}
                onClick={() => void answer(inv.boardId, true)}
              >
                {t('invites.accept')}
              </button>
              <button
                type="button"
                disabled={busyId === inv.boardId}
                onClick={() => void answer(inv.boardId, false)}
              >
                {t('invites.decline')}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
