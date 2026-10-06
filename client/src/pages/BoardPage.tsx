import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { BoardDetail } from 'shared';
import { ApiError, fetchBoard } from '../api/boards';
import { useAuthStore } from '../store/auth-store';
import { BoardCanvas } from '../canvas/BoardCanvas';
import type { BoardCanvasHandle } from '../canvas/BoardCanvas';
import { useBoardStore } from '../canvas/board-store';
import { useEditorStore } from '../canvas/editor-store';
import { useBoardPersistence } from '../canvas/useBoardPersistence';
import { useBoardSync } from '../canvas/useBoardSync';
import { useCanvasViewport } from '../canvas/useCanvasViewport';
import { getVisibleBoardRect, screenToBoard } from '../canvas/coordinates';
import { setAoiView } from '../canvas/aoi-sync';
import { syncStrategy } from '../canvas/sync-strategy';
import { fitToObjects } from '../canvas/fit-to-objects';
import { ContextPanel } from '../canvas/ContextPanel';
import { LinkPopover } from '../canvas/LinkPopover';
import { useLinkPreviews } from '../canvas/use-link-previews';
import { VideoOverlay } from '../canvas/VideoOverlay';
import { ChatPanel } from '../canvas/ChatPanel';
import { VoicePanel } from '../voice/VoicePanel';
import { setSelfUserId } from '../voice/voice-mesh';
import { Participants } from '../canvas/Participants';
import { usePresenceStore } from '../canvas/presence-store';
import { diag } from '../canvas/diag';
import { BackIcon, FitIcon } from '../canvas/icons';
import { Toolbar } from '../canvas/Toolbar';
import { BoardSearch } from '../canvas/BoardSearch';
import { ExportButton } from '../canvas/ExportButton';
import { VersionHistory } from '../canvas/VersionHistory';
import { centerOnObject } from '../canvas/board-search';
import { publishShowView } from '../canvas/presence-channel';
import { ShowViewButton } from '../canvas/ShowViewButton';
import { useShowView } from '../canvas/use-show-view';
import { KanbanView } from '../kanban/KanbanView';
import { usePreventBrowserZoom } from './usePreventBrowserZoom';
import { useNarrow } from '../use-narrow';
import { PinchDebug } from '../canvas/PinchDebug';
import { PINCH_DEBUG } from '../canvas/pinch-debug';
import { useTranslation } from 'react-i18next';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';
// що зараз показано — стан сторінки, не редактора: не персиститься, канбан
// це лише інший погляд на ті самі обʼєкти
type View = 'canvas' | 'kanban';

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
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>('canvas');
  const canvasRef = useRef<BoardCanvasHandle>(null);
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const objects = useBoardStore((s) => s.objects);
  const setCanEdit = useEditorStore((s) => s.setCanEdit);
  // роль із rest — те, що було на момент відкриття; selfRole — те, що сервер
  // думає про мене зараз. Власник міг знизити мене вже після завантаження,
  // і тоді діє свіжіше
  const selfRole = usePresenceStore((s) => s.selfRole);
  const editable = !!board && canEdit(board, currentUserId) && selfRole !== 'VIEWER';
  // чужу камеру смикає лише власник чи адміністратор — решті кнопки просто
  // нема (сервер такий кадр однаково викидає). Та сама перевірка, що на
  // стільцях у ContextPanel
  const canShowView = selfRole === 'OWNER' || selfRole === 'ADMIN';

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

  useShowView(viewport, canvasSize, setViewport);
  // прев'ю посилань збирається саме, у фоні — кнопок для цього немає
  useLinkPreviews(openBoardId, editable);

  // стратегія 3 передплачується на клітинки біля видимого; для інших стратегій
  // виклик нічого не робить. дебаунс — усередині синхронізації
  useEffect(() => {
    if (canvasSize.width > 0 && canvasSize.height > 0) {
      setAoiView(getVisibleBoardRect(viewport, canvasSize.width, canvasSize.height));
    }
  }, [viewport, canvasSize.width, canvasSize.height]);

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

  // одноразовий кадр. Шлемо ТОЧКУ ДОШКИ, яка в мене посеред екрана, а не
  // свій viewport.x/y: той рахується від краю мого вікна, і на чужому екрані
  // іншого розміру вміст від нього виїжджав у куток
  function handleShowView(targets?: string[]) {
    const { x: centerX, y: centerY } = screenToBoard(center, viewport);
    publishShowView({ centerX, centerY, scale: viewport.scale, targets });
  }

  // з картки канбану на полотно — те саме, що стрибок із пошуку
  function handleLocate(id: string) {
    const object = useBoardStore.getState().getById(id);
    if (!object) return;
    useEditorStore.getState().select(id);
    setViewport(centerOnObject(object, viewport, canvasSize.width, canvasSize.height));
    setView('canvas');
  }

  function handleFitAll() {
    setViewport(fitToObjects(Object.values(objects), canvasSize.width, canvasSize.height));
  }

  // у шапці телефона місця вже нема: три іконки підряд стискали назву дошки
  // до кількох пікселів. Тому там кнопка живе в правій колонці, поруч із
  // рештою іконок-накладок
  const showViewButton = board && canShowView && (
    <ShowViewButton
      key={`${board.id}:${currentUserId}`}
      boardId={board.id}
      currentUserId={currentUserId}
      onShare={handleShowView}
    />
  );

  const exportButton = board && (
    <ExportButton title={board.title} capture={() => canvasRef.current?.capture() ?? null} />
  );

  // історія версій — лише власнику й адміну, як і «показати мій вид»: решті
  // її не видно зовсім, і сервер список їм теж не віддає
  const historyButton = board && canShowView && <VersionHistory key={board.id} boardId={board.id} />;

  // точка дошки під серединою полотна: сюди лягають стікери з канбану і
  // вставлені картинки — щоб були перед очима, а не в (0,0) десь далеко
  const visibleCenter = screenToBoard(center, viewport);
  const kanbanOrigin = { x: visibleCenter.x - 80, y: visibleCenter.y - 60 };

  if (state === 'loading') {
    return <p className="board-page-message">{t('common.loading')}</p>;
  }

  if (state === 'not-found') {
    return (
      <div className="board-page-message">
        <h1>{t('board.notFound')}</h1>
        <p>
          <Link to="/">{t('board.back')}</Link>
        </p>
      </div>
    );
  }

  if (syncStatus === 'kicked') {
    return (
      <div className="board-page-message">
        <h1>{t('board.closedTitle')}</h1>
        <p>{t('board.closedText')}</p>
        <p>
          <Link to="/">{t('board.back')}</Link>
        </p>
      </div>
    );
  }

  if (state === 'error' || !board) {
    return <p className="board-page-message">{t('board.loadFailed')}</p>;
  }

  return (
    <div className="board-page">
      <header className="board-toolbar">
        <button
          type="button"
          className="icon-button board-back"
          title={t('board.back')}
          aria-label={t('board.back')}
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
            {t('board.canvas')}
          </button>
          <button
            type="button"
            className={view === 'kanban' ? 'active' : ''}
            onClick={() => setView('kanban')}
          >
            {t('board.kanban')}
          </button>
        </div>
        {/* на телефоні −/100%/+ прибираємо: масштаб там щипком, а в шапці
        вони видавлювали «показати все» за край екрана */}
        {view === 'canvas' && (
          <div className="zoom-controls">
            <BoardSearch viewport={viewport} canvasSize={canvasSize} onJump={setViewport} />
            {!narrow && showViewButton}
            {!narrow && exportButton}
            {!narrow && historyButton}
            {!narrow && (
              <>
                <button
                  type="button"
                  className="icon-button"
                  title={t('board.zoomOut')}
                  onClick={() => zoomOut(center)}
                >
                  −
                </button>
                <span className="zoom-percent">{Math.round(viewport.scale * 100)}%</span>
                <button
                  type="button"
                  className="icon-button"
                  title={t('board.zoomIn')}
                  onClick={() => zoomIn(center)}
                >
                  +
                </button>
              </>
            )}
            <button
              type="button"
              className={narrow ? 'icon-button' : undefined}
              title={t('board.fitAll')}
              aria-label={t('board.fitAll')}
              onClick={handleFitAll}
            >
              {narrow ? <FitIcon /> : t('board.fitAll')}
            </button>
          </div>
        )}
      </header>
      <div className="board-workspace">
        {view === 'canvas' ? (
          <>
            <Toolbar boardId={board.id} currentUserId={currentUserId} visibleCenter={visibleCenter} />
            <BoardCanvas
              ref={canvasRef}
              boardId={board.id}
              viewport={viewport}
              spaceHeld={spaceHeld}
              stageHandlers={stageHandlers}
              touchInput={touchInput}
              onSizeChange={setCanvasSize}
              currentUserId={currentUserId}
            />
            {PINCH_DEBUG && <PinchDebug />}
            {/* дивитись відео може й глядач — це не правка вмісту, тож
            накладка поза перевіркою editable */}
            <VideoOverlay />
            {/* панель — самі дії над обʼєктами, глядачу показувати нічого */}
            {editable && (
              <>
                <ContextPanel viewport={viewport} canvasSize={canvasSize} currentUserId={currentUserId} />
                <LinkPopover boardId={board.id} viewport={viewport} canvasSize={canvasSize} currentUserId={currentUserId} />
              </>
            )}
          </>
        ) : (
          <KanbanView currentUserId={currentUserId} origin={kanbanOrigin} onLocate={handleLocate} />
        )}
        {/* чат і голос не залежать від того, що показано — полотно чи канбан.
        На телефоні всі три збираються в одну колонку праворуч, інакше вони
        розповзаються по кутах і налазять одне на одне */}
        <div className={narrow ? 'mobile-rail' : 'contents'}>
          {narrow && view === 'canvas' && showViewButton}
          {narrow && view === 'canvas' && exportButton}
          {narrow && view === 'canvas' && historyButton}
          <Participants />
          <ChatPanel boardId={board.id} />
          <VoicePanel boardId={board.id} currentUserId={currentUserId} ownerId={board.ownerId} />
        </div>
        {/* режим кімнати — у атрибут: стенд ним звіряє, що міряє саме те, що просив,
            а на другому пристрої це найшвидший спосіб побачити, чим він працює */}
        <div className={`board-island sync-status ${syncStatus}`} data-strategy={syncStrategy()}>
          {t(`board.sync.${syncStatus}`)}
        </div>
        <div className="board-island save-status">{t(`board.save.${saveStatus}`)}</div>
      </div>
    </div>
  );
}
