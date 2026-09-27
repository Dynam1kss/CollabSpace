import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import type { BoardSummary } from 'shared';
import { logout } from '../api/auth';
import { createBoard, deleteBoard, fetchBoards, renameBoard } from '../api/boards';
import { useAuthStore } from '../store/auth-store';
import { BoardMembers } from './BoardMembers';
import { EmptyBoardsIcon, MoreIcon } from '../canvas/icons';
import { colorForBoard, LISTS_POLL_MS, relativeTime } from './board-card';
import { PendingInvites } from './PendingInvites';
import { useNarrow } from '../use-narrow';
import { usePoll } from '../use-poll';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { errorText } from '../i18n/api-error';

export function BoardsPage() {
  const { t } = useTranslation();
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
      .catch((err) => setError(errorText(err, i18n.t('boards.loadFailed'))))
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
      setError(errorText(err, t('boards.createFailed')));
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
      setError(errorText(err, t('boards.renameFailed')));
    }
  };

  const handleDelete = async (id: string) => {
    setMenuOpenId(null);
    if (!window.confirm(t('boards.deleteConfirm'))) return;
    try {
      await deleteBoard(id);
      setBoards((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      setError(errorText(err, t('boards.deleteFailed')));
    }
  };

  return (
    <div>
      <header className="boards-header">
        {user && (
          <span className="boards-me-row">
            <Avatar userId={user.id} name={user.displayName} url={user.avatarUrl} size={36} />
            <span className="boards-me">
              <strong title={user.displayName}>{user.displayName}</strong>
              <span className="board-role" title={user.email}>
                {user.email}
              </span>
            </span>
          </span>
        )}
        <span className="boards-header-actions">
          <Link to="/settings" className="button-link">
            {t('boards.settings')}
          </Link>
          <button type="button" onClick={handleLogout} className="button-link">
            {t('boards.logout')}
          </button>
        </span>
      </header>
      <h1 className="boards-title">{t('boards.title')}</h1>

      <form onSubmit={handleCreate} className="board-create-form">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t('boards.newBoard')}
          aria-label={t('boards.newBoard')}
        />
        <button type="submit" className="button-primary" disabled={!newTitle.trim()}>
          {t('boards.create')}
        </button>
      </form>

      <PendingInvites onAccepted={() => void loadBoards()} />

      {error && <p className="form-error">{error}</p>}
      {loading && <p>{t('common.loading')}</p>}
      {!loading && boards.length === 0 && (
        <div className="boards-empty">
          <EmptyBoardsIcon />
          <p>
            <strong>{t('boards.emptyTitle')}</strong>
            {t('boards.emptyText')}
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
                  aria-label={t('boards.boardName')}
                  autoFocus
                />
                <div className="board-rename-actions">
                  <button type="button" onClick={() => submitRename(board.id)}>
                    {t('common.save')}
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Link className="board-open" to={`/boards/${board.id}`}>
                  {board.title}
                </Link>
                <span className="board-meta">
                  <span>{t('boards.updated', { when: relativeTime(board.updatedAt) })}</span>
                  {!board.isOwner && <span className="role-chip">{t(`roles.${board.myRole}`)}</span>}
                </span>
                {(board.isOwner || board.myRole === 'ADMIN') && (
                  <BoardCardMenu
                    open={menuOpenId === board.id}
                    onToggle={() => setMenuOpenId(menuOpenId === board.id ? null : board.id)}
                    onClose={() => setMenuOpenId(null)}
                  >
                    {board.isOwner && (
                      <button type="button" onClick={() => startRename(board)}>
                        {t('boards.rename')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpenId(null);
                        setMembersOpenId(membersOpenId === board.id ? null : board.id);
                      }}
                    >
                      {t('boards.members')}
                    </button>
                    {board.isOwner && (
                      <button type="button" className="danger" onClick={() => handleDelete(board.id)}>
                        {t('common.delete')}
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
                    <span>{t('boards.membersOf', { title: board.title })}</span>
                    <button
                      type="button"
                      className="icon-button"
                      title={t('common.close')}
                      aria-label={t('common.close')}
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

  const { t } = useTranslation();
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
        title={t('boards.actions')}
        aria-label={t('boards.actions')}
        aria-expanded={open}
        onClick={onToggle}
      >
        <MoreIcon />
      </button>
      {open && <div className="board-menu-popover">{children}</div>}
    </div>
  );
}
