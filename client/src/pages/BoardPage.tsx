import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { ChatPanel } from '../canvas/ChatPanel';
import { VoicePanel } from '../voice/VoicePanel';
import { setSelfUserId } from '../voice/voice-mesh';
import { Participants } from '../canvas/Participants';
import { usePresenceStore } from '../canvas/presence-store';
import { diag } from '../canvas/diag';
import { BackIcon, FitIcon } from '../canvas/icons';
import { Toolbar } from '../canvas/Toolbar';
import { KanbanView } from '../kanban/KanbanView';
import { usePreventBrowserZoom } from './usePreventBrowserZoom';
import { useNarrow } from '../use-narrow';

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
  kicked: 'доступ забрано',
};

// скільки людина бачить пояснення, перш ніж її віднесе до списку дошок
const KICKED_REDIRECT_MS = 2500;

// глядач нічого не зберігає і не змінює — сервер і так відхилить, але й
// пробувати не варто. Адміністратор для цієї перевірки — той самий редактор
function canEdit(board: BoardDetail, userId: string) {
  return (
    board.isOwner ||
    board.members.some((m) => m.userId === userId && (m.role === 'EDITOR' || m.role === 'ADMIN'))
  );
}

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>('canvas');
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const objects = useBoardStore((s) => s.objects);
  const setCanEdit = useEditorStore((s) => s.setCanEdit);
  // роль із rest — те, що було на момент відкриття; selfRole — те, що сервер
  // думає про мене зараз. Власник міг знизити мене вже після завантаження,
  // і тоді діє свіжіше
  const selfRole = usePresenceStore((s) => s.selfRole);
  const editable = !!board && canEdit(board, currentUserId) && selfRole !== 'VIEWER';

  const narrow = useNarrow();

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

  // монтування й розмонтування самої сторінки дошки — крайні точки всього
  // життєвого циклу, від них і читається решта журналу
  // голос має знати, хто я: примусове вимкнення адресується за userId
  useEffect(() => {
    setSelfUserId(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    diag('сторінку дошки змонтовано', { boardId: id });
    return () => diag('сторінку дошки розмонтовано', { boardId: id });
  }, [id]);

  const { viewport, spaceHeld, touchInput, zoomIn, zoomOut, resetView, setViewport, stageHandlers } =
    useCanvasViewport({
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

  // власник забрав доступ просто зараз: даємо прочитати, чому, і відводимо
  // до списку — лишати людину на дошці, якої в неї вже нема, нема сенсу
  useEffect(() => {
    if (syncStatus !== 'kicked') return;
    const timer = window.setTimeout(() => navigate('/'), KICKED_REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [syncStatus, navigate]);

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

  if (syncStatus === 'kicked') {
    return (
      <div className="board-page-message">
        <h1>Доступ до дошки закрито</h1>
        <p>Власник видалив вас із цієї дошки.</p>
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
        <button
          type="button"
          className="icon-button board-back"
          title="До списку дошок"
          aria-label="До списку дошок"
          onClick={() => navigate('/')}
        >
          <BackIcon />
        </button>
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
        {/* на телефоні −/100%/+ прибираємо: масштаб там щипком, а в шапці
        вони видавлювали «показати все» за край екрана */}
        {view === 'canvas' && (
          <div className="zoom-controls">
            {!narrow && (
              <>
                <button type="button" className="icon-button" title="Зменшити" onClick={() => zoomOut(center)}>
                  −
                </button>
                <span className="zoom-percent">{Math.round(viewport.scale * 100)}%</span>
                <button type="button" className="icon-button" title="Збільшити" onClick={() => zoomIn(center)}>
                  +
                </button>
              </>
            )}
            <button
              type="button"
              className={narrow ? 'icon-button' : undefined}
              title="Показати все"
              aria-label="Показати все"
              onClick={handleFitAll}
            >
              {narrow ? <FitIcon /> : 'Показати все'}
            </button>
          </div>
        )}
      </header>
      <div className="board-workspace">
        {view === 'canvas' ? (
          <>
            <Toolbar boardId={board.id} currentUserId={currentUserId} visibleCenter={visibleCenter} />
            <BoardCanvas
              boardId={board.id}
              viewport={viewport}
              spaceHeld={spaceHeld}
              stageHandlers={stageHandlers}
              touchInput={touchInput}
              onSizeChange={setCanvasSize}
              currentUserId={currentUserId}
            />
            {/* панель — самі дії над обʼєктами, глядачу показувати нічого */}
            {editable && <ContextPanel viewport={viewport} canvasSize={canvasSize} />}
          </>
        ) : (
          <KanbanView currentUserId={currentUserId} origin={kanbanOrigin} />
        )}
        {/* чат і голос не залежать від того, що показано — полотно чи канбан.
        На телефоні всі три збираються в одну колонку праворуч, інакше вони
        розповзаються по кутах і налазять одне на одне */}
        <div className={narrow ? 'mobile-rail' : 'contents'}>
          <Participants />
          <ChatPanel boardId={board.id} />
          <VoicePanel boardId={board.id} currentUserId={currentUserId} ownerId={board.ownerId} />
        </div>
        <div className={`board-island sync-status ${syncStatus}`}>{SYNC_STATUS_TEXT[syncStatus]}</div>
        <div className="board-island save-status">{SAVE_STATUS_TEXT[saveStatus]}</div>
      </div>
    </div>
  );
}
