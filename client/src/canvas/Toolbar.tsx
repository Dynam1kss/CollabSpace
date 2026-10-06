import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Point } from './coordinates';
import { useEditorStore } from './editor-store';
import type { ToolId } from './editor-store';
import {
  EllipseIcon,
  ImageIcon,
  LineIcon,
  LinkIcon,
  RectIcon,
  RedoIcon,
  SelectIcon,
  StickyIcon,
  TextIcon,
  UndoIcon,
} from './icons';
import { useUndoState } from './board-store';
import { redoBoard, undoBoard } from './board-undo';
import { placeImageFromFile } from './place-image';
import { useTranslation } from 'react-i18next';
import { errorText } from '../i18n/api-error';

// підписи — з перекладу за id (tools.<id>)
const TOOLS: { id: ToolId; hotkey: string; icon: ReactNode }[] = [
  { id: 'select', hotkey: 'V', icon: <SelectIcon /> },
  { id: 'sticky', hotkey: 'S', icon: <StickyIcon /> },
  { id: 'text', hotkey: 'T', icon: <TextIcon /> },
  { id: 'rect', hotkey: 'R', icon: <RectIcon /> },
  { id: 'ellipse', hotkey: 'E', icon: <EllipseIcon /> },
  { id: 'connector', hotkey: 'L', icon: <LineIcon /> },
  // K, бо L уже в прямої
  { id: 'link', hotkey: 'K', icon: <LinkIcon /> },
];

const HOTKEY_MAP: Record<string, ToolId> = Object.fromEntries(TOOLS.map((t) => [t.hotkey, t.id]));
const IMAGE_HOTKEY = 'I';
const ERROR_HIDE_MS = 5000;

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

interface Props {
  boardId: string;
  currentUserId: string;
  // точка дошки під серединою полотна — туди лягає вставлена картинка
  visibleCenter: Point;
}

export function Toolbar({ boardId, currentUserId, visibleCenter }: Props) {
  const { t } = useTranslation();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const canEdit = useEditorStore((s) => s.canEdit);
  // глядачу — лише «вибір», інструментів створення не показуємо
  const tools = canEdit ? TOOLS : TOOLS.filter((t) => t.id === 'select');
  const canUndo = useUndoState((s) => s.canUndo);
  const canRedo = useUndoState((s) => s.canRedo);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space') return; // пробіл лишається за тимчасовим паном (useCanvasViewport)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (key === IMAGE_HOTKEY && canEdit) {
        e.preventDefault();
        fileInputRef.current?.click();
        return;
      }
      const tool = HOTKEY_MAP[key];
      if (tool && (canEdit || tool === 'select')) {
        e.preventDefault();
        setActiveTool(tool);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, setActiveTool]);

  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), ERROR_HIDE_MS);
    return () => clearTimeout(id);
  }, [error]);

  // «зображення» — не режим, а одразу діалог вибору файла: малювати його нема як
  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await placeImageFromFile(boardId, file, visibleCenter, currentUserId);
    } catch (err) {
      setError(errorText(err, t('board.imageFailed')));
    } finally {
      setUploading(false);
      // інакше той самий файл удруге не вибрати — change не спрацює
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <>
      <aside className="board-island tool-island">
        {/* дві групи: інструменти й дії. На десктопі обгортки прозорі
        (display: contents), на телефоні панель лягає в рядок унизу — і тоді
        інструменти скроляться, а скасувати/повторити лишаються на місці */}
        <div className="tool-group tool-tools">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={tool.id === activeTool ? 'tool-button active' : 'tool-button'}
              title={`${t(`tools.${tool.id}`)} (${tool.hotkey})`}
              aria-label={t(`tools.${tool.id}`)}
              onClick={() => setActiveTool(tool.id)}
            >
              {tool.icon}
            </button>
          ))}
          {canEdit && (
            <button
              type="button"
              className={uploading ? 'tool-button uploading' : 'tool-button'}
              title={`${t('tools.image')} (${IMAGE_HOTKEY})`}
              aria-label={t('tools.image')}
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImageIcon />
            </button>
          )}
        </div>
        {/* скасувати/повторити — окрема група, відділена рискою: це не
        інструменти, а дії над тим, що вже зроблено. Для телефона це ще й
        ЄДИНИЙ спосіб скасувати — клавіатури там нема */}
        {canEdit && (
          <div className="tool-group tool-actions">
            <span className="tool-divider" />
            <button
              type="button"
              className="tool-button"
              title={`${t('tools.undo')} (Ctrl+Z)`}
              aria-label={t('tools.undo')}
              disabled={!canUndo}
              onClick={() => undoBoard()}
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="tool-button"
              title={`${t('tools.redo')} (Ctrl+Shift+Z)`}
              aria-label={t('tools.redo')}
              disabled={!canRedo}
              onClick={() => redoBoard()}
            >
              <RedoIcon />
            </button>
          </div>
        )}
        {canEdit && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        )}
      </aside>
      {error && <div className="board-island tool-error">{error}</div>}
    </>
  );
}
