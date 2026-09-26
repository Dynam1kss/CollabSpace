import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { StickyColumn, StickyObject } from 'shared';
import { useBoardStore } from '../canvas/board-store';
import type { Point } from '../canvas/coordinates';
import { useEditorStore } from '../canvas/editor-store';
import { createSticky } from '../canvas/object-defaults';
import { nextZIndex } from '../canvas/selection-actions';
import { TextEditor } from '../canvas/TextEditor';
import { LocateIcon } from '../canvas/icons';
import { colorForUser } from '../canvas/presence-colors';
import { lockOwner, usePresenceStore } from '../canvas/presence-store';

type ColumnKey = StickyColumn | null;

// три колонки фіксовані — це подання, а не окрема модель; "без колонки"
// першою, бо туди падають усі стікери з полотна, і з неї їх розтягують по решті
const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: null, label: 'Без колонки' },
  { key: 'todo', label: 'До зробити' },
  { key: 'in-progress', label: 'В процесі' },
  { key: 'done', label: 'Готово' },
];

const DRAG_THRESHOLD_PX = 4;
// нові стікери з канбану лягають сходинкою від origin, щоб не один на одного
const NEW_STICKY_STEP = 24;

interface Drag {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  // де в картці схопили — щоб примара не стрибала під курсор лівим кутом
  offsetX: number;
  offsetY: number;
  width: number;
  // рух перевищив поріг — це драг, а не клік
  active: boolean;
  over: ColumnKey | undefined;
}

interface Props {
  currentUserId: string;
  // точка на полотні (в координатах дошки), куди класти стікери, створені звідси
  origin: Point;
  onLocate: (id: string) => void;
}

// канбан — інший погляд на ті самі стікери з board-store: перетягування
// між колонками міняє лише column, x/y на полотні не чіпає. Драг вручну на
// pointer-подіях (pointermove/pointerup на window, як у гумової рамки)
export function KanbanView({ currentUserId, origin, onLocate }: Props) {
  const objects = useBoardStore((s) => s.objects);
  const canEdit = useEditorStore((s) => s.canEdit);
  const editingTextId = useEditorStore((s) => s.editingTextId);
  const startEditingText = useEditorStore((s) => s.startEditingText);
  // текст картки редагується тим самим TextEditor, що й на полотні, тому й
  // замок той самий — картку, в якій хтось друкує, не відкриваємо
  const presence = usePresenceStore();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // після драгу в межах тієї самої картки браузер ще кине click — його глушимо
  const suppressClickRef = useRef(false);
  // глядачу клік розгортає обрізаний текст — редагувати він не може
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stickies = Object.values(objects)
    .filter((o): o is StickyObject => o.type === 'sticky')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  useEffect(() => {
    function columnAt(x: number, y: number): ColumnKey | undefined {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-column]');
      if (!el) return undefined;
      const key = el.dataset.column;
      return key === 'none' ? null : (key as StickyColumn);
    }
    function handleMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const active =
        d.active ||
        Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD_PX ||
        Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD_PX;
      dragRef.current = {
        ...d,
        active,
        x: e.clientX,
        y: e.clientY,
        over: active ? columnAt(e.clientX, e.clientY) : undefined,
      };
      setDrag(dragRef.current);
    }
    function handleUp() {
      const d = dragRef.current;
      if (!d) return;
      if (d.active) {
        // click, якщо й буде, прилетить одразу за pointerup у цьому ж таску;
        // якщо відпустили над іншою колонкою — click на картку не прийде взагалі,
        // тому прапорець не можна лишати до наступного кліку
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        const target = useBoardStore.getState().getById(d.id);
        if (d.over !== undefined && target?.type === 'sticky' && target.column !== d.over) {
          useBoardStore.getState().update(d.id, { column: d.over });
        }
      }
      dragRef.current = null;
      setDrag(null);
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, []);

  function handleCardPointerDown(e: ReactPointerEvent<HTMLDivElement>, sticky: StickyObject) {
    if (!canEdit || e.button !== 0 || editingTextId === sticky.id) return;
    if (lockOwner(presence, sticky.id)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      id: sticky.id,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      over: undefined,
    };
  }

  function handleCardClick(sticky: StickyObject) {
    if (suppressClickRef.current) return;
    if (lockOwner(presence, sticky.id)) return;
    if (canEdit) startEditingText(sticky.id);
    else setExpandedId(expandedId === sticky.id ? null : sticky.id);
  }

  function handleAdd(column: ColumnKey) {
    const n = stickies.length;
    const point = { x: origin.x + n * NEW_STICKY_STEP, y: origin.y + n * NEW_STICKY_STEP };
    const sticky = createSticky(point, { createdBy: currentUserId, zIndex: nextZIndex() }, column);
    useBoardStore.getState().add(sticky);
    startEditingText(sticky.id);
  }

  const dragged = drag?.active ? objects[drag.id] : undefined;

  return (
    <div className="kanban">
      {COLUMNS.map((col) => {
        // стікери зі старих снепшотів поля column не мають — це "без колонки"
        const cards = stickies.filter((s) => (s.column ?? null) === col.key);
        const over = drag?.active && drag.over === col.key;
        return (
          <section
            key={col.key ?? 'none'}
            data-column={col.key ?? 'none'}
            className={`kanban-column${col.key === null ? ' unsorted' : ''}${over ? ' over' : ''}`}
          >
            <header className="kanban-column-header">
              <span>{col.label}</span>
              <span className="kanban-count">{cards.length}</span>
            </header>
            <div className="kanban-cards">
              {cards.map((sticky) => {
                const locked = lockOwner(presence, sticky.id);
                return (
                  <div
                    key={sticky.id}
                    className={[
                      'kanban-card',
                      canEdit && !locked ? 'draggable' : '',
                      locked ? 'locked' : '',
                      drag?.active && drag.id === sticky.id ? 'lifted' : '',
                      expandedId === sticky.id ? 'expanded' : '',
                    ].join(' ')}
                    style={{ background: sticky.fillColor, color: sticky.textColor }}
                    onPointerDown={(e) => handleCardPointerDown(e, sticky)}
                    onClick={() => handleCardClick(sticky)}
                  >
                    {locked && (
                      <span className="kanban-lock" style={{ background: colorForUser(locked.userId) }}>
                        <LockGlyph />
                        {locked.displayName}
                      </span>
                    )}
                    {/* клік по картці вже зайнятий редагуванням/розгортанням,
                    тому окрема кнопка, і вона не пускає подію далі в картку */}
                    <button
                      type="button"
                      className="kanban-locate"
                      title="Показати на полотні"
                      aria-label="Показати на полотні"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onLocate(sticky.id);
                      }}
                    >
                      <LocateIcon />
                    </button>
                    {editingTextId === sticky.id ? (
                      <TextEditor
                        object={sticky}
                        className="kanban-card-editor"
                        style={{ color: sticky.textColor }}
                      />
                    ) : sticky.text ? (
                      <p>{sticky.text}</p>
                    ) : (
                      <p className="kanban-empty">порожній стікер</p>
                    )}
                  </div>
                );
              })}
            </div>
            {canEdit && (
              <button type="button" className="kanban-add" onClick={() => handleAdd(col.key)}>
                +
              </button>
            )}
          </section>
        );
      })}
      {drag && dragged?.type === 'sticky' && (
        <div
          className="kanban-card kanban-ghost"
          style={{
            left: drag.x - drag.offsetX,
            top: drag.y - drag.offsetY,
            width: drag.width,
            background: dragged.fillColor,
            color: dragged.textColor,
          }}
        >
          <p>{dragged.text || ' '}</p>
        </div>
      )}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="9" height="11" viewBox="0 0 9 11" fill="none" aria-hidden="true">
      <path d="M2 4.5V3a2.5 2.5 0 0 1 5 0v1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.5" y="4.5" width="8" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}
