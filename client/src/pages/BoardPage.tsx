import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoardDetail } from 'shared';
import { ApiError, fetchBoard } from '../api/boards';
import { useAuthStore } from '../store/auth-store';
import { BoardCanvas } from '../canvas/BoardCanvas';
import { useBoardStore } from '../canvas/board-store';
import { useEditorStore } from '../canvas/editor-store';
import { useBoardPersistence } from '../canvas/useBoardPersistence';
import type { SaveStatus } from '../canvas/useBoardPersistence';
import { useBoardSync } from '../canvas/useBoardSync';
import type { SyncStatus } from '../canvas/useBoardSync';
import { useCanvasViewport } from '../canvas/useCanvasViewport';
import { screenToBoard } from '../canvas/coordinates';
import { fitToObjects } from '../canvas/fit-to-objects';
import { ContextPanel } from '../canvas/ContextPanel';
import { Toolbar } from '../canvas/Toolbar';
import { KanbanView } from '../kanban/KanbanView';
import { usePreventBrowserZoom } from './usePreventBrowserZoom';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';
// що зараз показано — стан сторінки, не редактора: не персиститься, канбан
// це лише інший погляд на ті самі обʼєкти
type View = 'canvas' | 'kanban';

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  loading: 'завантажую…',
  saving: 'зберігаю…',
  saved: 'збережено',
  error: 'не збереглось',
  readonly: 'лише перегляд',
};

const SYNC_STATUS_TEXT: Record<SyncStatus, string> = {
  connecting: 'підключення…',
  live: 'наживо',
  offline: 'офлайн',
};

// глядач нічого не зберігає і не змінює — сервер і так відхилить, але й пробувати не варто
function canEdit(board: BoardDetail, userId: string) {
  return board.isOwner || board.members.some((m) => m.userId === userId && m.role === 'EDITOR');
}

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>('canvas');
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const objects = useBoardStore((s) => s.objects);
  const setCanEdit = useEditorStore((s) => s.setCanEdit);
  const editable = !!board && canEdit(board, currentUserId);

  usePreventBrowserZoom();
  // sync — перед persistence: його ефект дає свіжий документ, у який persistence
  // потім вантажить снепшот; порядок ефектів у react — порядок оголошення
  const openBoardId = state === 'ready' && board ? board.id : null;
  const syncStatus = useBoardSync(openBoardId, editable);
  // 'наживо' тут означає «історія інших уже в документі» — тільки з цього
  // моменту можна писати снепшот, інакше затреш у базі те, чого ще не отримав
  const saveStatus = useBoardPersistence(openBoardId, editable, syncStatus === 'live');

  useEffect(() => {
    setCanEdit(editable);
    return () => setCanEdit(false);
  }, [editable, setCanEdit]);

  const { viewport, spaceHeld, zoomIn, zoomOut, resetView, setViewport, stageHandlers } = useCanvasViewport({
    x: 0,
    y: 0,
    scale: 1,
  });

  useEffect(() => {
    if (!id) return;
    fetchBoard(id)
      .then((data) => {
        setBoard(data);
        setState('ready');
      })
      .catch((err) => {
        setState(err instanceof ApiError && err.status === 404 ? 'not-found' : 'error');
      });
  }, [id]);

  const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };

  // щойно дізнались розмір полотна — центруємо початок координат дошки
  useEffect(() => {
    if (
      canvasSize.width > 0 &&
      canvasSize.height > 0 &&
      viewport.x === 0 &&
      viewport.y === 0 &&
      viewport.scale === 1
    ) {
      resetView(center);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasSize.width, canvasSize.height]);

  function handleFitAll() {
    setViewport(fitToObjects(Object.values(objects), canvasSize.width, canvasSize.height));
  }

  // точка дошки під серединою полотна: сюди лягають стікери з канбану і
  // вставлені картинки — щоб були перед очима, а не в (0,0) десь далеко
  const visibleCenter = screenToBoard(center, viewport);
  const kanbanOrigin = { x: visibleCenter.x - 80, y: visibleCenter.y - 60 };

  if (state === 'loading') {
    return <p className="board-page-message">Завантаження…</p>;
  }

  if (state === 'not-found') {
    return (
      <div className="board-page-message">
        <h1>Дошку не знайдено</h1>
        <p>
          <Link to="/">До списку дошок</Link>
        </p>
      </div>
    );
  }

  if (state === 'error' || !board) {
    return <p className="board-page-message">Не вдалося завантажити дошку</p>;
  }

  return (
    <div className="board-page">
      <header className="board-toolbar">
        <span className="board-title">{board.title}</span>
        <div className="view-switch">
          <button
            type="button"
            className={view === 'canvas' ? 'active' : ''}
            onClick={() => setView('canvas')}
          >
            Полотно
          </button>
          <button
            type="button"
            className={view === 'kanban' ? 'active' : ''}
            onClick={() => setView('kanban')}
          >
            Канбан
          </button>
        </div>
        {view === 'canvas' && (
          <div className="zoom-controls">
            <button type="button" className="icon-button" title="Зменшити" onClick={() => zoomOut(center)}>
              −
            </button>
            <span className="zoom-percent">{Math.round(viewport.scale * 100)}%</span>
            <button type="button" className="icon-button" title="Збільшити" onClick={() => zoomIn(center)}>
              +
            </button>
            <button type="button" onClick={handleFitAll}>
              Показати все
            </button>
          </div>
        )}
      </header>
      <div className="board-workspace">
        {view === 'canvas' ? (
          <>
            <Toolbar boardId={board.id} currentUserId={currentUserId} visibleCenter={visibleCenter} />
            <BoardCanvas
              viewport={viewport}
              spaceHeld={spaceHeld}
              stageHandlers={stageHandlers}
              onSizeChange={setCanvasSize}
              currentUserId={currentUserId}
            />
            {/* панель — самі дії над обʼєктами, глядачу показувати нічого */}
            {editable && <ContextPanel viewport={viewport} canvasSize={canvasSize} />}
          </>
        ) : (
          <KanbanView currentUserId={currentUserId} origin={kanbanOrigin} />
        )}
        <div className={`board-island sync-status ${syncStatus}`}>{SYNC_STATUS_TEXT[syncStatus]}</div>
        <div className="board-island save-status">{SAVE_STATUS_TEXT[saveStatus]}</div>
      </div>
    </div>
  );
}
