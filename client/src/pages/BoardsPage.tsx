import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { BoardSummary } from 'shared';
import { logout } from '../api/auth';
import { createBoard, deleteBoard, fetchBoards, renameBoard } from '../api/boards';
import { useAuthStore } from '../store/auth-store';
import { BoardMembers } from './BoardMembers';

export function BoardsPage() {
  const { user, setUser } = useAuthStore();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [membersOpenId, setMembersOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetchBoards()
      .then((data) => setBoards(data.boards))
      .catch((err) => setError(err instanceof Error ? err.message : 'Помилка завантаження'))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      const board = await createBoard({ title: newTitle.trim() });
      setBoards((prev) => [board, ...prev]);
      setNewTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося створити дошку');
    }
  };

  const startRename = (board: BoardSummary) => {
    setEditingId(board.id);
    setEditingTitle(board.title);
  };

  const submitRename = async (id: string) => {
    if (!editingTitle.trim()) return;
    try {
      const updated = await renameBoard(id, { title: editingTitle.trim() });
      setBoards((prev) => prev.map((b) => (b.id === id ? updated : b)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося перейменувати дошку');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Видалити дошку? Цю дію не можна скасувати.')) return;
    try {
      await deleteBoard(id);
      setBoards((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося видалити дошку');
    }
  };

  return (
    <div>
      <header>
        <span>{user?.displayName}</span>
        <button type="button" onClick={handleLogout}>
          Вийти
        </button>
      </header>
      <h1>Мої дошки</h1>

      <form onSubmit={handleCreate} className="board-create-form">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Назва нової дошки"
        />
        <button type="submit">Створити</button>
      </form>

      {error && <p className="form-error">{error}</p>}
      {loading && <p>Завантаження…</p>}
      {!loading && boards.length === 0 && <p>Дошок ще немає.</p>}

      <ul className="board-list">
        {boards.map((board) => (
          <li key={board.id}>
            {editingId === board.id ? (
              <>
                <input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} />
                <button type="button" onClick={() => submitRename(board.id)}>
                  Зберегти
                </button>
                <button type="button" onClick={() => setEditingId(null)}>
                  Скасувати
                </button>
              </>
            ) : (
              <>
                <Link to={`/boards/${board.id}`}>{board.title}</Link>
                {!board.isOwner && <span className="board-role"> (учасник)</span>}
                {board.isOwner && (
                  <>
                    <button type="button" onClick={() => startRename(board)}>
                      Перейменувати
                    </button>
                    <button type="button" onClick={() => handleDelete(board.id)}>
                      Видалити
                    </button>
                    <button
                      type="button"
                      onClick={() => setMembersOpenId(membersOpenId === board.id ? null : board.id)}
                    >
                      Учасники
                    </button>
                  </>
                )}
              </>
            )}
            {/* керування учасниками — власнику й адміністратору */}
            {!board.isOwner && board.myRole === 'ADMIN' && (
              <button
                type="button"
                onClick={() => setMembersOpenId(membersOpenId === board.id ? null : board.id)}
              >
                Учасники
              </button>
            )}
            {membersOpenId === board.id && (
              <BoardMembers boardId={board.id} myRole={board.myRole} ownerId={board.ownerId} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
