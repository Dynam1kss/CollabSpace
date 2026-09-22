import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { centerOnObject, searchObjects } from './board-search';
import type { Viewport } from './coordinates';
import { SearchIcon, StickyIcon, TextIcon } from './icons';
import { useNarrow } from '../use-narrow';

interface Props {
  viewport: Viewport;
  canvasSize: { width: number; height: number };
  onJump: (next: Viewport) => void;
}

// пошук тексту по дошці. Шукає в сторі, а не в Y.Doc: у сторі вже лежить те
// саме, і ходити в документ заради підрядка нема сенсу
export function BoardSearch({ viewport, canvasSize, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const objects = useBoardStore((s) => s.objects);
  const narrow = useNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchObjects(Object.values(objects), query), [objects, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // закриття по кліку повз — тим самим прийомом, що й палітра кольорів
  useEffect(() => {
    if (!open || narrow) return;
    function handlePointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, narrow]);

  function jumpTo(id: string) {
    const object = useBoardStore.getState().getById(id);
    if (!object) return;
    useEditorStore.getState().select(id);
    onJump(centerOnObject(object, viewport, canvasSize.width, canvasSize.height));
    if (narrow) setOpen(false);
  }

  // глобальні хоткеї полотна й так пропускають поля вводу (isTypingTarget),
  // але зупиняємо явно: інакше кожне нове поле доведеться згадувати там
  function handleKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (hits.length > 0) jumpTo(hits[0].id);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="icon-button"
        title="Пошук на дошці"
        aria-label="Пошук на дошці"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </button>
    );
  }

  const list = (
    <ul className="search-hits">
      {hits.map((hit) => (
        <li key={hit.id}>
          <button type="button" onClick={() => jumpTo(hit.id)}>
            <span className="search-hit-icon">{hit.type === 'sticky' ? <StickyIcon /> : <TextIcon />}</span>
            <span className="search-hit-text">{hit.snippet || '(порожній)'}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  // на телефоні попап шириною в 260px поруч із шапкою виглядав би затиснутим —
  // там та сама повноекранна накладка, що в чату й присутніх
  if (narrow) {
    return (
      <div className="board-island sheet-full board-search-sheet">
        <header className="sheet-head">
          <span>Пошук</span>
          <button
            type="button"
            className="icon-button"
            title="Закрити"
            aria-label="Закрити"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Текст на стікері чи в блоці"
          aria-label="Що шукати"
        />
        {list}
      </div>
    );
  }

  return (
    <div className="board-search" ref={ref}>
      <button
        type="button"
        className="icon-button active"
        title="Пошук на дошці"
        aria-label="Пошук на дошці"
        onClick={() => setOpen(false)}
      >
        <SearchIcon />
      </button>
      <div className="board-island search-popover">
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Текст на стікері чи в блоці"
          aria-label="Що шукати"
        />
        {list}
      </div>
    </div>
  );
}
