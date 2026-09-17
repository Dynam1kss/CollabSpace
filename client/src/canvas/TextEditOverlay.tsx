import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BoardObject, TextObject } from 'shared';
import { useBoardStore } from './board-store';
import { boardToScreen } from './coordinates';
import type { Viewport } from './coordinates';
import { useEditorStore } from './editor-store';
import { fitTextBox, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './text-layout';

interface Props {
  object: BoardObject;
  viewport: Viewport;
}

// подвійний клік по стікеру/тексту вмикає це — звичайний HTML <textarea>
// поверх полотна (Konva сам по собі текст не редагує), позиціюємо його за
// screen-координатами обʼєкта; Escape і втрата фокусу — завершують редагування
export function TextEditOverlay({ object, viewport }: Props) {
  const updateObject = useBoardStore((s) => s.update);
  const stopEditingText = useEditorStore((s) => s.stopEditingText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);
  // текстовий блок росте під час набору так само, як виросте після коміту
  const [textSize, setTextSize] = useState(() =>
    object.type === 'text' ? { width: object.width, height: object.height } : null,
  );

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  if (object.type !== 'sticky' && object.type !== 'text') return null;

  const screen = boardToScreen({ x: object.x, y: object.y }, viewport);
  const padding = object.type === 'sticky' ? 10 : 0;
  const fontSize = (object.type === 'text' ? object.fontSize : 16) * viewport.scale;
  const color = object.type === 'sticky' ? object.textColor : object.color;
  const size = textSize ?? { width: object.width, height: object.height };

  function commit() {
    if (committedRef.current) return;
    committedRef.current = true;
    const text = textareaRef.current?.value ?? '';
    if (object.type === 'text') {
      updateObject(object.id, { text, ...fitTextBox({ ...object, text }) });
    } else {
      updateObject(object.id, { text });
    }
    stopEditingText();
  }

  function handleInput() {
    if (object.type !== 'text') return;
    setTextSize(fitTextBox({ ...(object as TextObject), text: textareaRef.current?.value ?? '' }));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
    }
  }

  return (
    <textarea
      ref={textareaRef}
      className="board-text-editor"
      defaultValue={object.text}
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
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
