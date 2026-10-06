// сітка дошки для синхронізації з областю інтересу (стратегія 3, журнал 27.09).
// у кожної клітинки своя незалежна історія yjs і своя кімната на сервері, тому
// клієнт може не брати участі в історії клітинки взагалі — і жодних дірок у
// клоках: чужі клітинки для нього просто не існують
//
// 2000 одиниць дошки — це 1.5–2 екрани при масштабі 100% (1280–1920 px). Тоді
// видима область разом із запасом зачіпає 2×2–3×3 клітинки. Дрібніші — більше
// передплат, рукостискань і переїздів обʼєктів між клітинками під час тягання;
// більші — клієнт тягне зайве, і область інтересу нічого не відсікає
export const CELL_SIZE = 2000;

// запас навколо видимого: половина вікна з кожного боку. Клітинка встигає
// синхронізуватись, поки до неї ще докручують, і край екрана не буває порожнім
export const VIEW_MARGIN_RATIO = 0.5;

// ...але не менше за чверть клітинки. Половина вікна — це частка ЕКРАНА, і при
// сильному наближенні вона мізерна в одиницях дошки: на телефоні при 400%
// вікно із запасом виходило 195 одиниць, десята частина клітинки, і сусідня
// клітинка бралася в роботу тоді, коли вже заїжджала на екран (журнал 06.10)
export const VIEW_MARGIN_MIN = CELL_SIZE / 4;

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// «ix:iy» — коротко, читається в логах і однаково рахується на клієнті й сервері
export function cellKey(ix: number, iy: number) {
  return `${ix}:${iy}`;
}

export function parseCellKey(key: string): [number, number] | null {
  const m = /^(-?\d+):(-?\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function cellOfPoint(x: number, y: number) {
  return cellKey(Math.floor(x / CELL_SIZE), Math.floor(y / CELL_SIZE));
}

// клітинка обʼєкта — за центром його власної рамки x/y/width/height. Поворот
// свідомо не враховуємо: сервер мусить порахувати ту саму клітинку з голого
// json (для злиття снепшоту), а зсув центру від повороту поглинає запас огляду
export function cellOfObject(o: { x: number; y: number; width: number; height: number }) {
  return cellOfPoint(o.x + o.width / 2, o.y + o.height / 2);
}

// усі клітинки, яких торкається прямокутник (межа — включно)
export function cellsInRect(rect: CellRect): string[] {
  const x0 = Math.floor(rect.x / CELL_SIZE);
  const y0 = Math.floor(rect.y / CELL_SIZE);
  const x1 = Math.floor((rect.x + rect.width) / CELL_SIZE);
  const y1 = Math.floor((rect.y + rect.height) / CELL_SIZE);
  const out: string[] = [];
  for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) out.push(cellKey(ix, iy));
  return out;
}

// запас по кожній осі окремо: вікно буває дуже витягнутим — телефон стоймя
// це 390×844, і одне число на обидві осі там нічого не описує
export function viewMargin(view: CellRect) {
  return {
    mx: Math.max(view.width * VIEW_MARGIN_RATIO, VIEW_MARGIN_MIN),
    my: Math.max(view.height * VIEW_MARGIN_RATIO, VIEW_MARGIN_MIN),
  };
}

// видиме вікно разом із запасом — саме на ці клітинки клієнт і передплачується
export function cellsOfInterest(view: CellRect): string[] {
  const { mx, my } = viewMargin(view);
  return cellsInRect({
    x: view.x - mx,
    y: view.y - my,
    width: view.width + 2 * mx,
    height: view.height + 2 * my,
  });
}
