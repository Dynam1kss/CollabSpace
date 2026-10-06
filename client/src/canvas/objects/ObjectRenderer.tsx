import { memo } from 'react';
import type Konva from 'konva';
import type { BoardObject } from 'shared';
import { ConnectorShape } from './ConnectorShape';
import { ImageShape } from './ImageShape';
import { LineShape } from './LineShape';
import { ShapeNode } from './ShapeNode';
import { StickyNoteShape } from './StickyNoteShape';
import { TextShape } from './TextShape';

interface Props {
  object: BoardObject;
  isSelected: boolean;
  // текст цього обʼєкта зараз редагується в textarea поверх полотна
  isEditing: boolean;
  draggable: boolean;
  // потрібен конектору й прямій — щоб кружечки кінців були сталого розміру на екрані
  viewportScale: number;
  // дефолтне чорнило лежить поверх непрозорого — не підмінювати на світле
  inkOverFill: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

// пачка з нової клітинки міняє в сторі лише свої ключі, але сам objects —
// новий обʼєкт, і без memo react перемальовував усі вузли підряд: на дошці з
// 900 завантаженими обʼєктами один такий кадр виходив 107мс (журнал 06.10).
// порівняння мілке, і цього досить: пропси тут — або примітиви, або стабільні
// посилання (обʼєкт зі стору й registerRef, кешований за id у BoardCanvas)
export const ObjectRenderer = memo(function ObjectRenderer({
  object,
  isSelected,
  isEditing,
  draggable,
  viewportScale,
  inkOverFill,
  registerRef,
}: Props) {
  switch (object.type) {
    case 'sticky':
      return (
        <StickyNoteShape
          object={object}
          isSelected={isSelected}
          isEditing={isEditing}
          draggable={draggable}
          registerRef={registerRef}
        />
      );
    case 'text':
      return (
        <TextShape
          object={object}
          isSelected={isSelected}
          isEditing={isEditing}
          draggable={draggable}
          inkOverFill={inkOverFill}
          registerRef={registerRef}
        />
      );
    case 'shape':
      return (
        <ShapeNode
          object={object}
          isSelected={isSelected}
          draggable={draggable}
          inkOverFill={inkOverFill}
          registerRef={registerRef}
        />
      );
    case 'connector':
      return (
        <ConnectorShape
          object={object}
          isSelected={isSelected}
          draggable={draggable}
          viewportScale={viewportScale}
          inkOverFill={inkOverFill}
          registerRef={registerRef}
        />
      );
    case 'line':
      return (
        <LineShape
          object={object}
          isSelected={isSelected}
          draggable={draggable}
          viewportScale={viewportScale}
          inkOverFill={inkOverFill}
          registerRef={registerRef}
        />
      );
    case 'image':
      return (
        <ImageShape object={object} isSelected={isSelected} draggable={draggable} registerRef={registerRef} />
      );
  }
});
