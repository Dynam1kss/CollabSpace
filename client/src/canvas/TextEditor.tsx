import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { StickyObject, TextObject } from 'shared';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';
import { fitTextBox } from './text-layout';

interface Props {
  object: StickyObject | TextObject;
  className: string;
  style?: CSSProperties;
  wrap?: 'off' | 'soft';
  onInput?: (text: string) => void;
}

// сам textarea з логікою коміту — спільний для оверлею на полотні й картки
// канбану, різниця лише в тому, де він стоїть і як виглядає (style/className
// дає той, хто рендерить). Escape і втрата фокусу — завершують редагування
export function TextEditor({ object, className, style, wrap, onInput }: Props) {
  const updateObject = useBoardStore((s) => s.update);
  const stopEditingText = useEditorStore((s) => s.stopEditingText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      commit();
    }
  }

  return (
    <textarea
      ref={textareaRef}
      className={className}
      defaultValue={object.text}
      wrap={wrap}
      style={style}
      onInput={() => onInput?.(textareaRef.current?.value ?? '')}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
