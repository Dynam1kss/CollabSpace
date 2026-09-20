import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { canManageMember } from 'shared';
import type { BoardMemberInfo, BoardRole } from 'shared';
import { ApiError, addBoardMember, fetchBoard, removeBoardMember, updateBoardMemberRole } from '../api/boards';

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
      setError('Ваші права на цій дошці змінились — оновіть сторінку');
      return;
    }
    setError(err instanceof Error ? err.message : fallback);
  };

  useEffect(() => {
    fetchBoard(boardId)
      .then((board) => setMembers(board.members))
      .catch((err) => setError(err instanceof Error ? err.message : 'Помилка завантаження'));
  }, [boardId]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Введіть пошту користувача');
      return;
    }
    try {
      const board = await addBoardMember(boardId, email.trim(), role);
      setMembers(board.members);
      setEmail('');
      setError(null);
    } catch (err) {
      handleFailure(err, 'Не вдалося додати учасника');
    }
  };

  const handleRoleChange = async (userId: string, next: BoardRole) => {
    setBusyUserId(userId);
    try {
      const board = await updateBoardMemberRole(boardId, userId, next);
      setMembers(board.members);
      setError(null);
    } catch (err) {
      handleFailure(err, 'Не вдалося змінити роль');
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
      handleFailure(err, 'Не вдалося видалити учасника');
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
      {members === null && !error && <p>Завантаження…</p>}
      {members && members.length === 0 && <p className="board-role">Учасників ще немає.</p>}
      {members && members.length > 0 && (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.userId}>
              {/* імʼя і пошта поруч: імена бувають однакові, пошта — ні */}
              <span className="member-who">
                {m.displayName}
                <span className="board-role"> {m.email}</span>
              </span>
              <select
                value={m.role}
                disabled={busyUserId === m.userId || !canManage(m)}
                aria-label={`Роль: ${m.email}`}
                onChange={(e) => handleRoleChange(m.userId, e.target.value as BoardRole)}
              >
                <option value="ADMIN">Адміністратор</option>
                <option value="EDITOR">Редактор</option>
                <option value="VIEWER">Глядач</option>
              </select>
              <button type="button" disabled={!canManage(m)} onClick={() => handleRemove(m.userId)}>
                Видалити
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
          placeholder="Пошта користувача"
        />
        <select value={role} onChange={(e) => setRole(e.target.value as BoardRole)}>
          <option value="ADMIN">Адміністратор</option>
          <option value="EDITOR">Редактор</option>
          <option value="VIEWER">Глядач</option>
        </select>
        <button type="submit">Додати</button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
