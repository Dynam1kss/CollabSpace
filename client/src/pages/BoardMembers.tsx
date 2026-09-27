import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { canManageMember } from 'shared';
import type { BoardMemberInfo, BoardRole } from 'shared';
import { Avatar } from '../components/Avatar';
import {
  ApiError,
  addBoardMember,
  fetchBoard,
  removeBoardMember,
  updateBoardMemberRole,
} from '../api/boards';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { errorText } from '../i18n/api-error';

interface Props {
  boardId: string;
  // моя роль на цій дошці: адміністратор керує не всіма, тому кнопки й
  // списки гасимо там, де сервер однаково відмовить
  myRole: 'OWNER' | BoardRole;
  // потрібен для ієрархії: адміністратора, якого підняв власник, чіпає
  // лише власник
  ownerId: string;
}

// розкривна секція під дошкою у списку (лише для власника): список
// учасників приходить окремим GET /boards/:id — у списку дошок його нема
export function BoardMembers({ boardId, myRole, ownerId }: Props) {
  const { t } = useTranslation();
  // та сама ієрархія, що й на сервері — щоб не показувати дію, яка дасть 403
  const canManage = (m: BoardMemberInfo) => canManageMember(myRole, m, ownerId);
  const [members, setMembers] = useState<BoardMemberInfo[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BoardRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);
  // кого саме зараз перемикаємо — щоб не блокувати весь список
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // мої права на цій дошці могли змінитись, поки панель була відкрита.
  // сервер їх перечитує на кожен запит і відмовляє — а панель лишалась із
  // тими кнопками, що й були, і людина не розуміла, чому нічого не діється
  const [lost, setLost] = useState(false);

  // 403/404 від будь-якої дії означає «прав уже немає» — ховаємо панель,
  // а не просто показуємо помилку під списком
  const handleFailure = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      setLost(true);
      setError(t('members.rightsChanged'));
      return;
    }
    setError(errorText(err, fallback));
  };

  useEffect(() => {
    fetchBoard(boardId)
      .then((board) => setMembers(board.members))
      // i18n.t, а не t: інакше ефект перезапитував би учасників на кожну зміну мови
      .catch((err) => setError(errorText(err, i18n.t('boards.loadFailed'))));
  }, [boardId]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('members.enterEmail'));
      return;
    }
    try {
      const board = await addBoardMember(boardId, email.trim(), role);
      setMembers(board.members);
      setEmail('');
      setError(null);
    } catch (err) {
      handleFailure(err, t('members.inviteFailed'));
    }
  };

  const handleRoleChange = async (userId: string, next: BoardRole) => {
    setBusyUserId(userId);
    try {
      const board = await updateBoardMemberRole(boardId, userId, next);
      setMembers(board.members);
      setError(null);
    } catch (err) {
      handleFailure(err, t('members.roleFailed'));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeBoardMember(boardId, userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
      setError(null);
    } catch (err) {
      handleFailure(err, t('members.removeFailed'));
    }
  };

  if (lost) {
    return (
      <div className="board-members">
        <p className="form-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="board-members">
      {members === null && !error && <p>{t('common.loading')}</p>}
      {members && members.length === 0 && <p className="board-role">{t('members.none')}</p>}
      {members && members.length > 0 && (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.userId}>
              {/* імʼя і пошта поруч: імена бувають однакові, пошта — ні */}
              <Avatar userId={m.userId} name={m.displayName} url={m.avatarUrl} size={28} />
              <span className="member-who">
                {m.displayName}
                <span className="board-role"> {m.email}</span>
                {m.status === 'PENDING' && (
                  <span className="member-pending" title={t('members.pendingHint')}>
                    {t('members.pending')}
                  </span>
                )}
              </span>
              <select
                value={m.role}
                disabled={busyUserId === m.userId || !canManage(m)}
                aria-label={t('members.roleOf', { email: m.email })}
                onChange={(e) => handleRoleChange(m.userId, e.target.value as BoardRole)}
              >
                <option value="ADMIN">{t('roleNames.ADMIN')}</option>
                <option value="EDITOR">{t('roleNames.EDITOR')}</option>
                <option value="VIEWER">{t('roleNames.VIEWER')}</option>
              </select>
              <button type="button" disabled={!canManage(m)} onClick={() => handleRemove(m.userId)}>
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="member-add-form">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('members.emailPlaceholder')}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as BoardRole)}>
          <option value="ADMIN">{t('roleNames.ADMIN')}</option>
          <option value="EDITOR">{t('roleNames.EDITOR')}</option>
          <option value="VIEWER">{t('roleNames.VIEWER')}</option>
        </select>
        <button type="submit">{t('members.invite')}</button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
