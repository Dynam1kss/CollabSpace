import Konva from 'konva';
import type { TextObject } from 'shared';

// один шрифт і для konva, і для textarea редагування — інакше переноси
// рядків у редакторі й на полотні не збігаються
export const TEXT_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
export const TEXT_LINE_HEIGHT = 1.2;

// щоб порожній/однобуквений текст лишався за що вхопити
const MIN_TEXT_WIDTH = 24;

// один прихований вузол на всі виміри — konva міряє текст через canvas,
// створювати вузол на кожен виклик дорого і без потреби
const measurer = new Konva.Text({ fontFamily: TEXT_FONT_FAMILY, lineHeight: TEXT_LINE_HEIGHT });

// розмір блоку під його вміст тим самим алгоритмом, яким konva його малює —
// інакше рамка й реальний текст розійдуться на пів рядка
export function fitTextBox(
  obj: Pick<TextObject, 'text' | 'fontSize' | 'width' | 'autoWidth' | 'minHeight'>,
): { width: number; height: number } {
  measurer.setAttrs({
    text: obj.text,
    fontSize: obj.fontSize,
    width: obj.autoWidth ? 'auto' : obj.width,
    wrap: obj.autoWidth ? 'none' : 'word',
  });
  return {
    width: obj.autoWidth ? Math.max(MIN_TEXT_WIDTH, measurer.width()) : obj.width,
    height: Math.max(obj.minHeight, measurer.height()),
  };
}
