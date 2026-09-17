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
  const saveStatus = useBoardPersistence(state === 'ready' && board ? board.id : null, editable);

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

  // стікери з канбану кладемо туди, де зараз видима середина полотна — щоб
  // після повернення на полотно вони були перед очима, а не в (0,0) десь далеко
  const kanbanOrigin = screenToBoard({ x: center.x - 80, y: center.y - 60 }, viewport);

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
            <Toolbar />
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
        <div className="board-island save-status">{SAVE_STATUS_TEXT[saveStatus]}</div>
      </div>
    </div>
  );
}
