import type Konva from 'konva';
import type { BoardObject } from 'shared';
import { ConnectorShape } from './ConnectorShape';
import { ImageShape } from './ImageShape';
import { ShapeNode } from './ShapeNode';
import { StickyNoteShape } from './StickyNoteShape';
import { TextShape } from './TextShape';

interface Props {
  object: BoardObject;
  isSelected: boolean;
  // текст цього обʼєкта зараз редагується в textarea поверх полотна
  isEditing: boolean;
  draggable: boolean;
  // потрібен лише конектору — щоб кружечки кінців були сталого розміру на екрані
  viewportScale: number;
  // дефолтне чорнило лежить поверх непрозорого — не підмінювати на світле
  inkOverFill: boolean;
  registerRef: (node: Konva.Node | null) => void;
}

export function ObjectRenderer({
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
    case 'image':
      return (
        <ImageShape object={object} isSelected={isSelected} draggable={draggable} registerRef={registerRef} />
      );
  }
}
