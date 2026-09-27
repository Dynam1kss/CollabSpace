import { useEffect, useMemo, useState } from 'react';
import { Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ImageObject } from 'shared';
import { useBoardStore } from '../board-store';
import { useDragGesture } from './useDragGesture';
import { useSelectOnPointerDown } from './useSelectOnPointerDown';
import { useCanvasColors } from '../../theme';

interface Props {
  object: ImageObject;
  isSelected: boolean;
  draggable: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function ImageShape({ object, isSelected, draggable, registerRef }: Props) {
  const colors = useCanvasColors();
  const updateSoon = useBoardStore((s) => s.updateSoon);
  const flushUpdates = useBoardStore((s) => s.flushUpdates);
  const handlePointerDown = useSelectOnPointerDown(object.id);
  const { onDragStart, onDragEnd } = useDragGesture();
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  // звичайний Image без бібліотек; поки вантажиться — сіра заглушка (fill нижче)
  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = object.url;
    return () => {
      // компонент міг зникнути до onload — не смикати setState на розмонтованому
      img.onload = null;
    };
  }, [object.url]);

  // дзеркалення малюємо В САМ РАСТР, а не відʼємним scale на вузлі: цей вузол
  // належить трансформеру, і відʼємний scale на ньому зламав би всю
  // математику розміру (саме з неї починались попередні баги). Тут же вузол
  // лишається з scale 1, а x/y/width/height — рівно ті, що порахував resize
  const flipX = object.flipX ?? false;
  const flipY = object.flipY ?? false;
  const source = useMemo(() => {
    if (!image || (!flipX && !flipY)) return image;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return image;
    ctx.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(image, 0, 0);
    return canvas;
  }, [image, flipX, flipY]);

  // позицію пишемо в стор на кожен рух, а не лише на dragend — інакше інші
  // бачать не рух, а стрибок на місце. так само наживо давно їде точка конектора
  const commitPosition = (e: KonvaEventObject<DragEvent>) => {
    updateSoon(object.id, { x: e.target.x(), y: e.target.y() });
  };

  const handleDragEnd = (e: KonvaEventObject<DragEvent>) => {
    onDragEnd();
    commitPosition(e);
    flushUpdates();
  };

  return (
    <KonvaImage
      ref={registerRef}
      id={object.id}
      x={object.x}
      y={object.y}
      width={object.width}
      height={object.height}
      rotation={object.rotation}
      image={source ?? undefined}
      fill={image ? undefined : colors.placeholder}
      // konva малює stroke під картинкою, видно лише зовнішню половину — тому 3, а не 1.5
      stroke={isSelected ? colors.accent : undefined}
      strokeWidth={isSelected ? 3 : 0}
      strokeScaleEnabled={false}
      draggable={draggable}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onDragStart={onDragStart}
      onDragMove={commitPosition}
      onDragEnd={handleDragEnd}
    />
  );
}
