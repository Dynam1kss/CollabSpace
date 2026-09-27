import { Shape } from 'react-konva';
import type Konva from 'konva';
import { getVisibleBoardRect } from './coordinates';
import type { Viewport } from './coordinates';
import { FACTOR, gridLevels } from './grid-levels';

interface Props {
  viewport: Viewport;
  width: number;
  height: number;
  // колір лінії і її сила — з теми; новий sceneFunc змушує konva перемалювати
  rgb: string;
  lineAlpha: number;
}

// фон дошки — вкладені рівні сітки, як у miro. Клітинки мають розмір у
// координатах ДОШКИ, тому їдуть і масштабуються разом з обʼєктами. Видно
// завжди рівно два сусідні рівні: грубіший у повну силу, дрібніший
// проявляється тим більше, чим ближче зум. Коли дрібніший дозріває до повної
// видимості, нумерація зсувається на один — і всередині нього починає
// проявлятись наступний, ще дрібніший. У зворотний бік так само: дрібний
// тане, грубий лишається
export function Grid({ viewport, width, height, rgb, lineAlpha }: Props) {
  if (width === 0 || height === 0) return null;

  const rect = getVisibleBoardRect(viewport, width, height);
  const { fineSpacing, fineAlpha, coarseSpacing } = gridLevels(viewport.scale);

  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context: Konva.Context) => {
        // малюємо в координатах дошки — трансформ Stage переводить їх на
        // екран сам. Тому товщину лінії ділимо на масштаб, інакше на
        // віддаленні вона зникне, а на наближенні розповзеться
        context.lineWidth = 1 / viewport.scale;
        // дрібний рівень малюємо БЕЗ кожної пʼятої лінії — вони належать
        // грубому. Інакше спільні лінії штрихуються двічі й темнішають тим
        // більше, чим яскравіший дрібний рівень: на переході рівнів це давало
        // помітний стрибок, хоч самі лінії й лишались на місці
        drawLevel(context, rect, fineSpacing, fineAlpha * lineAlpha, rgb, true);
        drawLevel(context, rect, coarseSpacing, lineAlpha, rgb, false);
      }}
    />
  );
}

// один рівень: лінії з кроком spacing по видимій області. Кількість ліній
// обмежена самим вибором рівня (крок на екрані завжди не менший за
// FADE_IN_PX), тому вона не росте ні при якому зумі. Ідемо по НОМЕРАХ ліній,
// а не додаванням кроку — інакше на сотнях ітерацій набігає похибка
function drawLevel(
  context: Konva.Context,
  rect: { x: number; y: number; width: number; height: number },
  spacing: number,
  alpha: number,
  rgb: string,
  skipCoarse: boolean,
) {
  // поріг відносно повної сили рівня — інакше з малою альфою теми зник би й грубий
  if (alpha < 0.002) return;
  const endX = rect.x + rect.width;
  const endY = rect.y + rect.height;
  context.beginPath();
  for (let i = Math.floor(rect.x / spacing); i * spacing <= endX; i++) {
    if (skipCoarse && i % FACTOR === 0) continue;
    context.moveTo(i * spacing, rect.y);
    context.lineTo(i * spacing, endY);
  }
  for (let j = Math.floor(rect.y / spacing); j * spacing <= endY; j++) {
    if (skipCoarse && j % FACTOR === 0) continue;
    context.moveTo(rect.x, j * spacing);
    context.lineTo(endX, j * spacing);
  }
  context.strokeStyle = `rgba(${rgb}, ${alpha})`;
  context.stroke();
}
