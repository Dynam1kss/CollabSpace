import { useEffect, useRef, useState } from 'react';
import { parseLinkUrl, LINK_URL_MAX } from 'shared';
import { useTranslation } from 'react-i18next';
import { useBoardStore } from './board-store';
import { boardToScreen } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { linkPatchWithSize } from './link-layout';
import { loadLinkPreview } from './link-preview';
import { openLink } from './link-open';
import { createLink } from './object-defaults';
import { nextZIndex } from './selection-actions';

// поповер для адреси картки: при створенні — лише адреса, при правці наявної
// (подвійний клік) — ще й підпис. Звичайні DOM-поля поверх полотна, як і
// textarea редагування тексту: у konva поля введення немає
interface Props {
  boardId: string;
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  currentUserId: string;
}

const WIDTH = 280;
const GAP = 10;

export function LinkPopover({ boardId, viewport, canvasSize, currentUserId }: Props) {
  const draft = useEditorStore((s) => s.linkDraft);
  const editingId = useEditorStore((s) => s.editingLinkId);
  const editing = useBoardStore((s) => (editingId ? s.objects[editingId] : undefined));
  const target = editing?.type === 'link' ? editing : null;

  if (draft) {
    return (
      <Form
        key="draft"
        at={clamp(draft.screen, canvasSize)}
        initialUrl=""
        withOpen={false}
        onCancel={() => useEditorStore.getState().closeLinkDraft()}
        onSubmit={(parsed) => {
          const object = createLink(draft.board, parsed, {
            createdBy: currentUserId,
            zIndex: nextZIndex(),
          });
          useBoardStore.getState().add(object);
          useEditorStore.getState().closeLinkDraft();
          // як і решта інструментів створення: поставив — вернувся у «вибір»
          useEditorStore.getState().setActiveTool('select');
          useEditorStore.getState().select(object.id);
          void loadLinkPreview(boardId, object.id);
        }}
      />
    );
  }

  if (!target) return null;
  const screen = boardToScreen({ x: target.x, y: target.y + target.height }, viewport);
  return (
    <Form
      key={target.id}
      at={clamp({ x: screen.x, y: screen.y + GAP }, canvasSize)}
      initialUrl={target.url}
      withOpen
      onCancel={() => useEditorStore.getState().stopEditingLink()}
      onSubmit={(parsed) => {
        useBoardStore
          .getState()
          .update(
            target.id,
            linkPatchWithSize(target, { url: parsed.url, kind: parsed.kind, videoId: parsed.videoId }),
          );
        useEditorStore.getState().stopEditingLink();
        void loadLinkPreview(boardId, target.id);
      }}
    />
  );
}

// поповер не має вилазити за полотно — інакше поле введення опиняється під
// краєм вікна й до нього не дотягнутись
function clamp(point: { x: number; y: number }, canvas: { width: number; height: number }) {
  return {
    x: Math.max(GAP, Math.min(point.x, Math.max(GAP, canvas.width - WIDTH - GAP))),
    y: Math.max(GAP, Math.min(point.y, Math.max(GAP, canvas.height - 120))),
  };
}

interface FormProps {
  at: { x: number; y: number };
  initialUrl: string;
  // при правці наявної картки поруч із «зберегти» ще й «відкрити»
  withOpen: boolean;
  onCancel: () => void;
  onSubmit: (parsed: NonNullable<ReturnType<typeof parseLinkUrl>>) => void;
}

function Form({ at, initialUrl, withOpen, onCancel, onSubmit }: FormProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initialUrl);
  const [invalid, setInvalid] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // клік поза поповером і Escape закривають його — так само, як палітру
  // кольорів у контекстній панелі
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  function submit() {
    const parsed = parseLinkUrl(url);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    onSubmit(parsed);
  }

  return (
    <div className="board-island link-popover" style={{ left: at.x, top: at.y }} ref={ref}>
      <input
        ref={inputRef}
        type="url"
        inputMode="url"
        className="link-input"
        placeholder={t('link.placeholder')}
        aria-label={t('link.url')}
        maxLength={LINK_URL_MAX}
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {invalid && <span className="link-invalid">{t('link.invalid')}</span>}
      <span className="link-actions">
        <button type="button" className="link-submit" onClick={submit}>
          {withOpen ? t('link.save') : t('link.add')}
        </button>
        {withOpen && (
          <button type="button" className="link-open" onClick={() => openLink(url)}>
            {t('link.open')}
          </button>
        )}
      </span>
    </div>
  );
}
