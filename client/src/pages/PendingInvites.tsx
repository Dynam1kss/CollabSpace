import { useEffect, useState } from 'react';
import type { BoardInvite } from 'shared';
import { Avatar } from '../components/Avatar';
import { anchorOf, openProfileCard } from '../components/profile-card-store';
import { acceptInvite, declineInvite, fetchInvites } from '../api/invites';
import { usePoll } from '../use-poll';
import { LISTS_POLL_MS } from './board-card';
import { useTranslation } from 'react-i18next';
import { errorText } from '../i18n/api-error';

interface Props {
  // після «прийняти» дошка має зʼявитись у списку — його тягне сторінка
  onAccepted: () => void;
}

// той, хто покликав. status PENDING — це і є саме запрошення: картка покаже
// «запрошено N тому», а не «учасник N»
function inviterCard(inv: BoardInvite, by: NonNullable<BoardInvite['invitedBy']>) {
  return {
    person: {
      userId: by.userId,
      displayName: by.displayName,
      avatarUrl: by.avatarUrl,
      bio: by.bio,
      email: by.email,
    },
    context: {
      kind: 'membership' as const,
      role: inv.role,
      status: 'PENDING' as const,
      since: inv.createdAt,
    },
  };
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
        {invites.map((inv) => {
          const by = inv.invitedBy;
          return (
            <li key={inv.boardId}>
              {/* картка того, хто запросив: роль, яку дають, і коли покликали.
            присутності тут нема — на дошку ще навіть не погодились */}
              {by && (
                <button
                  type="button"
                  className="profile-open"
                  aria-label={t('profile.open', { name: by.displayName })}
                  onClick={(e) => openProfileCard({ ...inviterCard(inv, by), at: anchorOf(e) })}
                >
                  <Avatar userId={by.userId} name={by.displayName} url={by.avatarUrl} size={36} />
                </button>
              )}
              <span className="invite-info">
                <strong>{inv.boardTitle}</strong>
                <span className="board-role">
                  {by
                    ? t('invites.invitedBy', { name: by.displayName, email: by.email })
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
          );
        })}
      </ul>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
