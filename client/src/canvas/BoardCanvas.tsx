import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { Grid } from './Grid';
import type { Viewport } from './coordinates';

interface StageHandlers {
  onWheel: (e: KonvaEventObject<WheelEvent>) => void;
  onMouseDown: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp: (e: KonvaEventObject<MouseEvent>) => void;
  onContextMenu: (e: KonvaEventObject<PointerEvent>) => void;
  onTouchStart: (e: KonvaEventObject<TouchEvent>) => void;
  onTouchMove: (e: KonvaEventObject<TouchEvent>) => void;
  onTouchEnd: (e: KonvaEventObject<TouchEvent>) => void;
}

interface Props {
  viewport: Viewport;
  spaceHeld: boolean;
  stageHandlers: StageHandlers;
  onSizeChange: (size: { width: number; height: number }) => void;
}

// суто відображення — стан і жести живуть у useCanvasViewport в BoardPage,
// цей компонент лише міряє свій розмір і малює Stage
export function BoardCanvas({ viewport, spaceHeld, stageHandlers, onSizeChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      onSizeChange({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSizeChange]);

  return (
    <div ref={containerRef} className="board-canvas" style={{ cursor: spaceHeld ? 'grab' : 'default' }}>
      {size.width > 0 && size.height > 0 && (
        <Stage
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          {...stageHandlers}
        >
          <Layer listening={false}>
            <Grid viewport={viewport} width={size.width} height={size.height} />
          </Layer>
          <Layer>
            <Rect x={0} y={0} width={120} height={80} fill="#4a90d9" cornerRadius={6} />
            <Text x={0} y={-24} text="заглушка (0,0)" fontSize={16} fill="#333" />
          </Layer>
        </Stage>
      )}
    </div>
  );
}
