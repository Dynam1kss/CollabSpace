import { useEffect, useRef, useState } from 'react';
import { useBoardStore } from './board-store';
import { exportFileName, exportTargets, pdfPageSize } from './board-export';
import type { BoardCanvasHandle } from './BoardCanvas';
import { useEditorStore } from './editor-store';
import { ExportIcon } from './icons';
import { useNarrow } from '../use-narrow';

type Kind = 'png' | 'pdf';

interface Props {
  title: string;
  capture: BoardCanvasHandle['capture'];
}

// konva віддає прозоре тло — у pdf і в переглядачах воно стає чорним чи в клітинку
function onWhite(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('нема 2d-контексту');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // одразу відкликати не можна — фаєрфокс ще не встиг почати завантаження
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// експорт у png чи pdf — виділеного, якщо щось виділено, інакше всієї дошки.
// Це знімок, не зміна — тому доступний будь-якій ролі, як пошук і «показати все»
export function ExportButton({ title, capture }: Props) {
  const narrow = useNarrow();
  const objects = useBoardStore((s) => s.objects);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const empty = Object.keys(objects).length === 0;
  // те саме правило, що в capture, — щоб напис не обіцяв виділене, коли id
  // уже застарілі і піде вся дошка
  const onlySelected = exportTargets(objects, selectedIds).onlySelected;
  const label = onlySelected ? 'Експорт виділеного' : 'Експорт дошки';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // закриття по кліку повз — тим самим прийомом, що пошук і «показати мій вид»
  useEffect(() => {
    if (!open || narrow || busy) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, narrow, busy]);

  async function run(kind: Kind) {
    setBusy(kind);
    setError(null);
    // знімок синхронний і на великій дошці важкий — спершу даємо браузеру
    // домалювати «готую…», інакше кнопка замре без жодного відгуку
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const shot = capture();
      if (!shot) {
        setError('На дошці порожньо');
        return;
      }
      const image = onWhite(shot.canvas);
      const name = exportFileName(title, new Date(), kind);
      if (kind === 'png') {
        const blob = await new Promise<Blob | null>((resolve) => image.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('toBlob віддав null');
        downloadBlob(blob, name);
      } else {
        // jspdf важить більше за решту клієнта разом — тягнемо лише коли треба
        const { jsPDF } = await import('jspdf');
        const page = pdfPageSize(shot.frame.width, shot.frame.height);
        // orientation обовʼязково: інакше jspdf сам міняє сторони місцями під portrait
        const pdf = new jsPDF({
          orientation: page.width > page.height ? 'landscape' : 'portrait',
          unit: 'pt',
          format: [page.width, page.height],
        });
        pdf.addImage(image, 'PNG', 0, 0, page.width, page.height, undefined, 'FAST');
        pdf.save(name);
      }
      setOpen(false);
    } catch {
      setError('Не вдалося зберегти файл');
    } finally {
      setBusy(null);
    }
  }

  const body = empty ? (
    <p className="export-note">На дошці порожньо — нема що експортувати</p>
  ) : (
    <>
      {onlySelected && <p className="export-note">Лише виділені обʼєкти</p>}
      <ul className="export-list">
        <li>
          <button type="button" disabled={!!busy} onClick={() => run('png')}>
            {busy === 'png' ? 'Готую…' : 'Зображення (PNG)'}
          </button>
        </li>
        <li>
          <button type="button" disabled={!!busy} onClick={() => run('pdf')}>
            {busy === 'pdf' ? 'Готую…' : 'PDF'}
          </button>
        </li>
      </ul>
      {error && <p className="export-note export-error">{error}</p>}
    </>
  );

  const toggle = (
    <button
      type="button"
      className={`${narrow ? 'board-island ' : ''}icon-button export-toggle${open ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-expanded={open}
      disabled={!!busy}
      onClick={() => setOpen(!open)}
    >
      <ExportIcon />
    </button>
  );

  if (narrow) {
    return (
      <>
        {toggle}
        {open && (
          <div className="board-island sheet-full">
            <header className="sheet-head">
              <span>{label}</span>
              <button
                type="button"
                className="icon-button"
                title="Закрити"
                aria-label="Закрити"
                disabled={!!busy}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            {body}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="export-group" ref={ref}>
      {toggle}
      {open && <div className="board-island export-popover">{body}</div>}
    </div>
  );
}
