import { useEffect, useRef, useState } from 'react';
import { fileKind } from 'shared';
import type { FileObject } from 'shared';
import { useTranslation } from 'react-i18next';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { fileUrl, humanSize } from './file-layout';

// найбільше, скільки читаємо для текстового перегляду. Показуємо саме ТЕКСТ,
// ніколи не html: вставити чужу розмітку в свою сторінку — найпростіший спосіб
// віддати їй своє походження
const TEXT_MAX_BYTES = 1024 * 1024;

export function FilePreview({ boardId }: { boardId: string }) {
  const objectId = useEditorStore((s) => s.previewFileId);
  const object = useBoardStore((s) => (objectId ? s.objects[objectId] : undefined));
  const file = object?.type === 'file' ? object : null;
  if (!file) return null;
  return <Overlay key={file.id} boardId={boardId} file={file} />;
}

function Overlay({ boardId, file }: { boardId: string; file: FileObject }) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const url = fileUrl(boardId, file.fileId);
  const kind = fileKind(file.mime);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // фокус вертаємо на картку: людина закрила перегляд і має лишитись там, де була
  function close() {
    const id = useEditorStore.getState().previewFileId;
    useEditorStore.getState().closeFilePreview();
    if (id) useEditorStore.getState().select(id);
    document.querySelector<HTMLElement>('.board-canvas canvas')?.focus();
  }

  return (
    <div className="file-preview" onPointerDown={close}>
      <div className="file-preview-box" onPointerDown={(e) => e.stopPropagation()}>
        <header className="file-preview-head">
          <span className="file-preview-name" title={file.name}>
            {file.name}
          </span>
          <span className="file-preview-meta">{humanSize(file.size)}</span>
          {/* завантажити можна завжди, хай би що було всередині */}
          <a className="file-preview-download" href={url} download={file.name}>
            {t('file.download')}
          </a>
          <button ref={closeRef} type="button" className="file-preview-close" aria-label={t('link.close')} onClick={close}>
            ×
          </button>
        </header>
        <div className="file-preview-body">
          <Body kind={kind} url={url} mime={file.mime} name={file.name} size={file.size} />
        </div>
      </div>
    </div>
  );
}

function Body({
  kind,
  url,
  mime,
  name,
  size,
}: {
  kind: ReturnType<typeof fileKind>;
  url: string;
  mime: string;
  name: string;
  size: number;
}) {
  const { t } = useTranslation();
  if (kind === 'image') return <ZoomableImage url={url} name={name} />;
  if (kind === 'pdf') return <iframe className="file-preview-frame" src={url} title={name} />;
  if (kind === 'video') return <video className="file-preview-media" src={url} controls />;
  if (kind === 'audio') return <audio className="file-preview-audio" src={url} controls />;
  if (kind === 'text') return <TextBody url={url} />;
  return (
    <div className="file-preview-plain">
      <p className="file-preview-plain-name">{name}</p>
      <p className="file-preview-meta">
        {humanSize(size)} · {mime}
      </p>
      <a className="file-preview-download" href={url} download={name}>
        {t('file.download')}
      </a>
    </div>
  );
}

// масштаб колесом, зсув тяганням — без бібліотек: двох станів досить
function ZoomableImage({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="file-preview-zoom"
      onWheel={(e) => setZoom((z) => Math.min(8, Math.max(0.2, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }}
    >
      <img
        src={url}
        alt={name}
        draggable={false}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
      />
    </div>
  );
}

function TextBody({ url }: { url: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // читаємо рівно стільки, скільки покажемо: решта файла нас не цікавить
    fetch(url, { headers: { Range: `bytes=0-${TEXT_MAX_BYTES - 1}` } })
      .then(async (res) => {
        const body = await res.text();
        if (cancelled) return;
        setText(body);
        setTruncated(res.status === 206);
      })
      .catch(() => {
        if (!cancelled) setText('');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // саме <pre> з текстовим вузлом: жодного dangerouslySetInnerHTML
  return (
    <div className="file-preview-text">
      {truncated && <p className="file-preview-meta">{t('file.textTooBig')}</p>}
      <pre>{text ?? ''}</pre>
    </div>
  );
}
