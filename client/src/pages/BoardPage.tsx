import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BoardDetail } from 'shared';
import { ApiError, fetchBoard } from '../api/boards';
import { BoardCanvas } from '../canvas/BoardCanvas';
import { useCanvasViewport } from '../canvas/useCanvasViewport';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const { viewport, spaceHeld, zoomIn, zoomOut, resetView, stageHandlers } = useCanvasViewport({
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
        <div className="zoom-controls">
          <button type="button" onClick={() => zoomOut(center)}>
            −
          </button>
          <span className="zoom-percent">{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoomIn(center)}>
            +
          </button>
          <button type="button" onClick={() => resetView(center)}>
            Показати все
          </button>
        </div>
      </header>
      <BoardCanvas
        viewport={viewport}
        spaceHeld={spaceHeld}
        stageHandlers={stageHandlers}
        onSizeChange={setCanvasSize}
      />
    </div>
  );
}
