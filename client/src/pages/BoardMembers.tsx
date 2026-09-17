import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { BoardMemberInfo, BoardRole } from 'shared';
import { addBoardMember, fetchBoard, removeBoardMember } from '../api/boards';

const ROLE_LABEL: Record<BoardRole, string> = {
  EDITOR: 'редактор',
  VIEWER: 'глядач',
};

interface Props {
  boardId: string;
}

// розкривна секція під дошкою у списку (лише для власника): список
// учасників приходить окремим GET /boards/:id — у списку дошок його нема
export function BoardMembers({ boardId }: Props) {
  const [members, setMembers] = useState<BoardMemberInfo[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BoardRole>('EDITOR');
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Не вдалося додати учасника');
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeBoardMember(boardId, userId);
      setMembers((prev) => prev?.filter((m) => m.userId !== userId) ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося видалити учасника');
    }
  };

  return (
    <div className="board-members">
      {members === null && !error && <p>Завантаження…</p>}
      {members && members.length === 0 && <p className="board-role">Учасників ще немає.</p>}
      {members && members.length > 0 && (
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.userId}>
              <span>{m.email}</span>
              <span className="board-role">{ROLE_LABEL[m.role]}</span>
              <button type="button" onClick={() => handleRemove(m.userId)}>
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
          <option value="EDITOR">Редактор</option>
          <option value="VIEWER">Глядач</option>
        </select>
        <button type="submit">Додати</button>
      </form>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
