import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { BoardSummary } from 'shared';
import { logout } from '../api/auth';
import { createBoard, deleteBoard, fetchBoards, renameBoard } from '../api/boards';
import { useAuthStore } from '../store/auth-store';
import { BoardMembers } from './BoardMembers';
import { EmptyBoardsIcon, MoreIcon } from '../canvas/icons';
import { colorForBoard, LISTS_POLL_MS, relativeTime, ROLE_TEXT } from './board-card';
import { PendingInvites } from './PendingInvites';
import { useNarrow } from '../use-narrow';
import { usePoll } from '../use-poll';

export function BoardsPage() {
  const { user, setUser } = useAuthStore();
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [membersOpenId, setMembersOpenId] = useState<string | null>(null);
  // яка картка розкрила меню дій; відкрите лише одне
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // на телефоні список учасників не влазить у картку — виносимо на весь екран
  const narrow = useNarrow();

  const loadBoards = () =>
    fetchBoards()
      .then((data) => setBoards(data.boards))
      .catch((err) => setError(err instanceof Error ? err.message : 'Помилка завантаження'))
      .finally(() => setLoading(false));

  useEffect(() => {
    void loadBoards();
  }, []);

  // фоновий запит мовчить про помилки: мережа на телефоні блимає, а червона
  // плашка від опитування, якого людина не просила, лише лякає
  usePoll(() => {
    fetchBoards()
      .then((data) => setBoards(data.boards))
      .catch(() => {});
  }, LISTS_POLL_MS);

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
    setMenuOpenId(null);
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
    setMenuOpenId(null);
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
      <header className="boards-header">
        <span className="boards-me">
          <strong>{user?.displayName}</strong>
          <span className="board-role">{user?.email}</span>
        </span>
        <button type="button" onClick={handleLogout} className="button-link">
          Вийти
        </button>
      </header>
      <h1 className="boards-title">Мої дошки</h1>

      <form onSubmit={handleCreate} className="board-create-form">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Назва нової дошки"
          aria-label="Назва нової дошки"
        />
        <button type="submit" className="button-primary" disabled={!newTitle.trim()}>
          Створити
        </button>
      </form>

      <PendingInvites onAccepted={() => void loadBoards()} />

      {error && <p className="form-error">{error}</p>}
      {loading && <p>Завантаження…</p>}
      {!loading && boards.length === 0 && (
        <div className="boards-empty">
          <EmptyBoardsIcon />
          <p>
            <strong>Тут поки порожньо</strong>
            Назвіть першу дошку у полі вище — і можна малювати.
          </p>
        </div>
      )}

      <ul className="board-list">
        {boards.map((board) => (
          <li
            key={board.id}
            className={membersOpenId === board.id && !narrow ? 'with-members' : undefined}
            style={{ borderTopColor: colorForBoard(board.id) }}
          >
            {editingId === board.id ? (
              <div className="board-rename">
                <input
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  aria-label="Назва дошки"
                  autoFocus
                />
                <div className="board-rename-actions">
                  <button type="button" onClick={() => submitRename(board.id)}>
                    Зберегти
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Скасувати
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Link className="board-open" to={`/boards/${board.id}`}>
                  {board.title}
                </Link>
                <span className="board-meta">
                  <span>оновлено {relativeTime(board.updatedAt)}</span>
                  {!board.isOwner && <span className="role-chip">{ROLE_TEXT[board.myRole]}</span>}
                </span>
                {(board.isOwner || board.myRole === 'ADMIN') && (
                  <BoardCardMenu
                    open={menuOpenId === board.id}
                    onToggle={() => setMenuOpenId(menuOpenId === board.id ? null : board.id)}
                    onClose={() => setMenuOpenId(null)}
                  >
                    {board.isOwner && (
                      <button type="button" onClick={() => startRename(board)}>
                        Перейменувати
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setMembersOpenId(membersOpenId === board.id ? null : board.id);
                      }}
                    >
                      Учасники
                    </button>
                    {board.isOwner && (
                      <button type="button" className="danger" onClick={() => handleDelete(board.id)}>
                        Видалити
                      </button>
                    )}
                  </BoardCardMenu>
                )}
              </>
            )}
            {membersOpenId === board.id &&
              (narrow ? (
                <div className="sheet-full members-sheet">
                  <header className="sheet-head">
                    <span>Учасники — {board.title}</span>
                    <button
                      type="button"
                      className="icon-button"
                      title="Закрити"
                      aria-label="Закрити"
                      onClick={() => setMembersOpenId(null)}
                    >
                      ×
                    </button>
                  </header>
                  <BoardMembers boardId={board.id} myRole={board.myRole} ownerId={board.ownerId} />
                </div>
              ) : (
                <BoardMembers boardId={board.id} myRole={board.myRole} ownerId={board.ownerId} />
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

// дії власника за «⋮», щоб у картці не стояло три голі кнопки поспіль.
// Закриття по кліку повз — тим самим прийомом, що й палітра кольорів
function BoardCardMenu({
  open,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onClose]);

  return (
    <div className="board-menu" ref={ref}>
      <button
        type="button"
        className="board-menu-button"
        title="Дії з дошкою"
        aria-label="Дії з дошкою"
        aria-expanded={open}
        onClick={onToggle}
      >
        <MoreIcon />
      </button>
      {open && <div className="board-menu-popover">{children}</div>}
    </div>
  );
}
