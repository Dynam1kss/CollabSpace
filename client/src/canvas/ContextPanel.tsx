import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardObject } from 'shared';
import { useBoardStore } from './board-store';
import { boardToScreen } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { BringFrontIcon, ChairIcon, SendBackIcon, StrokeWidthIcon, TextIcon, TrashIcon } from './icons';
import { NumberField } from './NumberField';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, PALETTE, STROKE_WIDTH_MAX, STROKE_WIDTH_MIN } from './object-defaults';
import { fitTextBox } from './text-layout';
import { useLockedByOthers, usePresenceStore } from './presence-store';
import { useNarrow } from '../use-narrow';
import { deleteSelected } from './selection-actions';

// над рамкою ще стирчить ручка повороту (rotateAnchorOffset 28 + кружок)
const GAP_ABOVE = 44;
const GAP_BELOW = 14;
const EDGE_MARGIN = 8;
// палітра відкривається від обʼєкта, тож над панеллю має лишатись місце й на неї
const POPOVER_ROOM = 40;

type PickerKind = 'fill' | 'text' | 'stroke';

interface Props {
  viewport: Viewport;
  canvasSize: { width: number; height: number };
}

// компактний рядок дій біля виділення: над ним, а якщо зверху не влазить —
// під ним. Показує лише те, що застосовне хоч до одного з виділених, і
// застосовує зміну до всіх, кому вона личить. Під час тягання ховається —
// стор відстає від вузлів до dragend
export function ContextPanel({ viewport, canvasSize }: Props) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const interacting = useEditorStore((s) => s.interacting);
  const objectsMap = useBoardStore((s) => s.objects);
  // те, що зараз редагує хтось інший, панель не чіпає — так само, як її
  // цілком нема в глядача. Лишилось порожньо — панель не показуємо взагалі
  const lockedByOthers = useLockedByOthers();
  // прапорець «сюди можна сідати» бачать лише власник і адміністратор:
  // решті він нічого не дає, тому й не показуємо навіть вимкненим
  const selfRole = usePresenceStore((s) => s.selfRole);
  const canManageSeats = selfRole === 'OWNER' || selfRole === 'ADMIN';
  const selected = selectedIds
    .map((id) => objectsMap[id])
    .filter((o): o is BoardObject => !!o && !lockedByOthers.has(o.id));
  const selectionKey = selectedIds.join(',');
  const ref = useRef<HTMLDivElement>(null);
  // на вузькому екрані панель не літає біля обʼєкта — прибита до низу
  const narrow = useNarrow();
  // відкрита палітра привʼязана до виділення — нове виділення її закриває
  const [picker, setPicker] = useState<{ key: string; kind: PickerKind } | null>(null);
  const openPicker = picker && picker.key === selectionKey ? picker.kind : null;

  const anchor = selected.length > 0 && !interacting ? selectionScreenRect(selected, viewport) : null;

  // позицію рахуємо після рендера — треба знати власний розмір панелі
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    if (narrow) {
      // координати лишились від десктопа — інакше перебʼють css нижньої шторки
      el.style.left = '';
      el.style.top = '';
      el.classList.remove('below');
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = anchor.y - GAP_ABOVE - h;
    const below = top < EDGE_MARGIN + POPOVER_ROOM;
    if (below) top = anchor.y + anchor.height + GAP_BELOW;
    el.style.left = `${clamp(anchor.x + anchor.width / 2 - w / 2, EDGE_MARGIN, canvasSize.width - w - EDGE_MARGIN)}px`;
    el.style.top = `${clamp(top, EDGE_MARGIN, canvasSize.height - h - EDGE_MARGIN)}px`;
    el.classList.toggle('below', below);
  });

  useEffect(() => {
    if (!openPicker) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setPicker(null);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openPicker]);

  if (!anchor) return null;

  const fillObject = selected.find((o) => o.type === 'sticky' || o.type === 'shape');
  const textColorObject = selected.find((o) => o.type === 'sticky' || o.type === 'text');
  const strokeObject = selected.find((o) => o.type === 'shape' || o.type === 'connector');
  const textObject = selected.find((o) => o.type === 'text');

  // увімкненим вважаємо, лише коли дозволено всім виділеним — інакше перший
  // клік має саме ВВІМКНУТИ решті, а не вимкнути тим, у кого вже стоїть
  const seatsOn = selected.length > 0 && selected.every((o) => o.seatsAllowed === true);

  function setSeatsAllowed(allowed: boolean) {
    const update = useBoardStore.getState().update;
    for (const o of selected) update(o.id, { seatsAllowed: allowed });
  }

  function togglePicker(kind: PickerKind) {
    setPicker(openPicker === kind ? null : { key: selectionKey, kind });
  }

  function setFill(color: string) {
    const update = useBoardStore.getState().update;
    for (const o of selected) {
      if (o.type === 'sticky' || o.type === 'shape') update(o.id, { fillColor: color });
    }
  }

  function setTextColor(color: string) {
    const update = useBoardStore.getState().update;
    for (const o of selected) {
      if (o.type === 'sticky') update(o.id, { textColor: color });
      if (o.type === 'text') update(o.id, { color });
    }
  }

  function setStrokeColor(color: string) {
    const update = useBoardStore.getState().update;
    for (const o of selected) {
      if (o.type === 'shape' || o.type === 'connector') update(o.id, { strokeColor: color });
    }
  }

  function setStrokeWidth(width: number) {
    const update = useBoardStore.getState().update;
    for (const o of selected) {
      if (o.type === 'shape' || o.type === 'connector') update(o.id, { strokeWidth: width });
    }
  }

  function setFontSize(fontSize: number) {
    const update = useBoardStore.getState().update;
    for (const o of selected) {
      if (o.type === 'text') update(o.id, { fontSize, ...fitTextBox({ ...o, fontSize }) });
    }
  }

  function bringToFront() {
    const update = useBoardStore.getState().update;
    const all = useBoardStore.getState().getAll();
    const maxZ = all.length ? Math.max(...all.map((o) => o.zIndex)) : 0;
    selected.forEach((o, i) => update(o.id, { zIndex: maxZ + 1 + i }));
  }

  function sendToBack() {
    const update = useBoardStore.getState().update;
    const all = useBoardStore.getState().getAll();
    const minZ = all.length ? Math.min(...all.map((o) => o.zIndex)) : 0;
    selected.forEach((o, i) => update(o.id, { zIndex: minZ - selected.length + i }));
  }

  return (
    <div ref={ref} className={narrow ? 'board-island ctx-panel ctx-sheet' : 'board-island ctx-panel'}>
      {fillObject && (fillObject.type === 'sticky' || fillObject.type === 'shape') && (
        <ColorButton
          label="Заливка"
          color={fillObject.fillColor}
          open={openPicker === 'fill'}
          onToggle={() => togglePicker('fill')}
          onPick={setFill}
        />
      )}
      {textColorObject && (textColorObject.type === 'sticky' || textColorObject.type === 'text') && (
        <ColorButton
          label="Колір тексту"
          color={textColorObject.type === 'sticky' ? textColorObject.textColor : textColorObject.color}
          open={openPicker === 'text'}
          onToggle={() => togglePicker('text')}
          onPick={setTextColor}
        />
      )}
      {strokeObject && (strokeObject.type === 'shape' || strokeObject.type === 'connector') && (
        <ColorButton
          label="Обведення"
          color={strokeObject.strokeColor}
          open={openPicker === 'stroke'}
          onToggle={() => togglePicker('stroke')}
          onPick={setStrokeColor}
        />
      )}

      {strokeObject && (strokeObject.type === 'shape' || strokeObject.type === 'connector') && (
        <NumberField
          label="Товщина обведення"
          icon={<StrokeWidthIcon />}
          value={strokeObject.strokeWidth}
          min={STROKE_WIDTH_MIN}
          max={STROKE_WIDTH_MAX}
          onCommit={setStrokeWidth}
        />
      )}
      {textObject && textObject.type === 'text' && (
        <NumberField
          label="Розмір шрифту"
          icon={<TextIcon />}
          value={textObject.fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          onCommit={setFontSize}
        />
      )}

      {canManageSeats && (
        <>
          <span className="ctx-sep" />
          <button
            type="button"
            className={seatsOn ? 'ctx-toggle active' : 'ctx-toggle'}
            title="Дозволити стільці"
            aria-label="Дозволити стільці"
            aria-pressed={seatsOn}
            onClick={() => setSeatsAllowed(!seatsOn)}
          >
            <ChairIcon />
          </button>
        </>
      )}

      <span className="ctx-sep" />
      <button type="button" title="На задній план" aria-label="На задній план" onClick={sendToBack}>
        <SendBackIcon />
      </button>
      <button type="button" title="На передній план" aria-label="На передній план" onClick={bringToFront}>
        <BringFrontIcon />
      </button>
      <span className="ctx-sep" />
      <button
        type="button"
        className="ctx-danger"
        title="Видалити"
        aria-label="Видалити"
        onClick={deleteSelected}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ColorButton({
  label,
  color,
  open,
  onToggle,
  onPick,
}: {
  label: string;
  color: string;
  open: boolean;
  onToggle: () => void;
  onPick: (color: string) => void;
}) {
  return (
    <div className="ctx-color">
      <button
        type="button"
        className="ctx-swatch"
        style={{ background: color }}
        title={label}
        aria-label={label}
        onClick={onToggle}
      />
      {open && (
        <div className="ctx-popover">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="ctx-swatch"
              style={{ background: c }}
              onClick={() => onPick(c)}
              aria-label={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(min, value), max);
}

// рамка виділення на екрані — обʼєднання кутів усіх обʼєктів з урахуванням
// повороту (еліпс крутиться довкола центру, решта — довкола лівого верхнього кута)
function selectionScreenRect(objects: BoardObject[], viewport: Viewport) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    for (const corner of rotatedCorners(obj)) {
      const p = boardToScreen(corner, viewport);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function rotatedCorners(obj: BoardObject) {
  const { x, y, width, height } = obj;
  const corners = [
    { x, y },
    { x: x + width, y },
    { x, y: y + height },
    { x: x + width, y: y + height },
  ];
  if (!obj.rotation) return corners;
  const aroundCenter = obj.type === 'shape' && obj.shapeKind === 'ellipse';
  const pivot = aroundCenter ? { x: x + width / 2, y: y + height / 2 } : { x, y };
  const rad = (obj.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return corners.map((c) => {
    const dx = c.x - pivot.x;
    const dy = c.y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  });
}
