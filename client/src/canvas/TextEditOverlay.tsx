import { useMemo, useState } from 'react';
import type { BoardObject } from 'shared';
import { boardToScreen } from './coordinates';
import type { Viewport } from './coordinates';
import { TextEditor } from './TextEditor';
import { fitTextBox, TEXT_FONT_FAMILY, TEXT_LINE_HEIGHT } from './text-layout';
import { inkFor, useTheme } from '../theme';
import { useBoardStore } from './board-store';
import { inkOverFill } from './ink-over-fill';

interface Props {
  object: BoardObject;
  viewport: Viewport;
}

// нижче цього порога мобільний сафарі зумить САМУ СТОРІНКУ, щойно поле
// отримає фокус, і назад уже не вертає (в нас ще й щипок глушиться, тому
// відзумити руками теж не вийде). На зменшеному полотні шрифт редактора
// виходив 4.5px, тобто далеко під порогом
const MIN_INPUT_FONT_PX = 16;

// подвійний клік по стікеру/тексту вмикає це — звичайний HTML <textarea>
// поверх полотна (Konva сам по собі текст не редагує), позиціюємо його за
// screen-координатами обʼєкта; сам textarea і коміт — у TextEditor
export function TextEditOverlay({ object, viewport }: Props) {
  const theme = useTheme();
  const objectsMap = useBoardStore((s) => s.objects);
  const overFill = useMemo(() => inkOverFill(Object.values(objectsMap)).has(object.id), [objectsMap, object.id]);
  // текстовий блок росте під час набору так само, як виросте після коміту
  const [textSize, setTextSize] = useState(() =>
    object.type === 'text' ? { width: object.width, height: object.height } : null,
  );

  if (object.type !== 'sticky' && object.type !== 'text') return null;

  const screen = boardToScreen({ x: object.x, y: object.y }, viewport);
  const padding = object.type === 'sticky' ? 10 : 0;
  // вільний текст лежить на полотні — те саме підмінене чорнило, що й у TextShape
  const color = object.type === 'sticky' ? object.textColor : inkFor(object.color, theme, overFill);
  const size = textSize ?? { width: object.width, height: object.height };

  // потрібний розмір на екрані може бути скільки завгодно малим, а полю
  // ставимо не менше порога і стискаємо все разом трансформом: у браузера
  // шрифт лишається великим, на екрані виглядає як і має
  const wantedFont = (object.type === 'text' ? object.fontSize : 16) * viewport.scale;
  const fontSize = Math.max(MIN_INPUT_FONT_PX, wantedFont);
  const shrink = wantedFont / fontSize;
  // коробку роздуваємо рівно настільки, наскільки її потім стисне трансформ —
  // щоб на екрані вона лягла точно на обʼєкт
  const boxWidth = ((size.width - padding * 2) * viewport.scale) / shrink;
  const boxHeight = ((size.height - padding * 2) * viewport.scale) / shrink;

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
        width: boxWidth,
        height: boxHeight,
        fontSize,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        color,
        // від лівого верхнього кута, як крутить і konva — інакше поворот
        // ішов би навколо центру коробки й не збігався з фігурою
        transformOrigin: 'top left',
        transform: `rotate(${object.rotation}deg) scale(${shrink})`,
      }}
      onInput={handleInput}
    />
  );
}
