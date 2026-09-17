import { useState } from 'react';
import type { BoardObject } from 'shared';
import { boardToScreen } from './coordinates';
import type { Viewport } from './coordinates';
import { TextEditor } from './TextEditor';
import { fitTextBox, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './text-layout';

interface Props {
  object: BoardObject;
  viewport: Viewport;
}

// подвійний клік по стікеру/тексту вмикає це — звичайний HTML <textarea>
// поверх полотна (Konva сам по собі текст не редагує), позиціюємо його за
// screen-координатами обʼєкта; сам textarea і коміт — у TextEditor
export function TextEditOverlay({ object, viewport }: Props) {
  // текстовий блок росте під час набору так само, як виросте після коміту
  const [textSize, setTextSize] = useState(() =>
    object.type === 'text' ? { width: object.width, height: object.height } : null,
  );

  if (object.type !== 'sticky' && object.type !== 'text') return null;

  const screen = boardToScreen({ x: object.x, y: object.y }, viewport);
  const padding = object.type === 'sticky' ? 10 : 0;
  const fontSize = (object.type === 'text' ? object.fontSize : 16) * viewport.scale;
  const color = object.type === 'sticky' ? object.textColor : object.color;
  const size = textSize ?? { width: object.width, height: object.height };

  function handleInput(text: string) {
    if (object.type === 'text') setTextSize(fitTextBox({ ...object, text }));
  }

  return (
    <TextEditor
      object={object}
      className="board-text-editor"
      wrap={object.type === 'text' && object.autoWidth ? 'off' : 'soft'}
      style={{
        left: screen.x + padding * viewport.scale,
        top: screen.y + padding * viewport.scale,
        width: (size.width - padding * 2) * viewport.scale,
        height: (size.height - padding * 2) * viewport.scale,
        fontSize,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        color,
        transform: `rotate(${object.rotation}deg)`,
      }}
      onInput={handleInput}
    />
  );
}
