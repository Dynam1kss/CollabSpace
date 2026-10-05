// перше місце — на колі навколо початку координат дошки, з кутом від id
// людини. Двоє не сядуть один в одного, і місце те саме на будь-якому
// пристрої. Від того, куди людина зараз дивиться, навмисно не залежить:
// полотно центрується на початку координат уже після того, як розмір відомий,
// тож «центр видимого» в цю мить ще не центр, і стілець ішов у куток. Та й
// прив'язка до випадкового погляду зробила б перше місце невідтворюваним
const SEAT_RING = 90;

export function defaultSeat(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) % 360;
  const angle = (hash * Math.PI) / 180;
  return { x: Math.cos(angle) * SEAT_RING, y: Math.sin(angle) * SEAT_RING };
}

// радіус стільця в координатах дошки на 100% зуму. Намальований він сталого
// розміру на екрані, тому в одиницях дошки «розпухає» при віддаленні — але
// за опорний беремо саме 100%: на віддаленому полотні перекривається все
// підряд, і обʼєкти теж, це властивість зуму, а не стільців
export const SEAT_RADIUS = 18;
// два стільці вважаємо розсунутими, коли кола не торкаються
export const SEAT_MIN_GAP = SEAT_RADIUS * 2 + 8;

export interface Point {
  x: number;
  y: number;
}

// обʼєкт дошки очима стільців. Поля ті самі, що в BoardObject, тому сюди
// просто віддають усе зі стору; у перевірках — голі літерали
export interface SeatBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  // градуси, як у konva
  rotation?: number;
  // обʼєкт, на який дозволено сідати, для пошуку місця не існує
  seatsAllowed?: boolean;
  type?: string;
  shapeKind?: string;
}

// конектор — штрих, а не площина: його рамка це переважно порожнє місце
// (у діагональної стрілки — цілий прямокутник ні з чим), і блокувати по ній
// означало б не давати сісти там, де насправді нічого немає. Тому лінії й
// стрілки не блокують узагалі, хоч якої вони товщини. Решта — площини
function blocksSeat(block: SeatBlock) {
  if (block.seatsAllowed) return false;
  if (block.type === 'connector') return false;
  return block.width > 0 && block.height > 0;
}

const isEllipse = (block: SeatBlock) => block.type === 'shape' && block.shapeKind === 'ellipse';

// опора повороту — та сама, що в object-pivot: у еліпса центр (ShapeNode
// зсуває його на пів розміру), у решти лівий верхній кут
function pivotOf(block: SeatBlock): Point {
  return isEllipse(block)
    ? { x: block.x + block.width / 2, y: block.y + block.height / 2 }
    : { x: block.x, y: block.y };
}

function spin(point: Point, pivot: Point, radians: number): Point {
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return {
    x: pivot.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: pivot.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

const radiansOf = (block: SeatBlock) => ((block.rotation ?? 0) * Math.PI) / 180;

// світ → власний неповернутий простір обʼєкта, і назад. Повернутий прямокутник
// перевіряємо саме так, а не по описаній рамці: інакше на 45° обʼєкт «займав»
// помітно більше, ніж намальовано
const toLocal = (point: Point, block: SeatBlock) => spin(point, pivotOf(block), -radiansOf(block));
const toWorld = (point: Point, block: SeatBlock) => spin(point, pivotOf(block), radiansOf(block));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

// найкоротший вихід із прямокутника із запасом SEAT_RADIUS; null — точка вже
// поза ним із цим запасом
function exitBox(local: Point, block: SeatBlock): Point | null {
  const x0 = block.x;
  const y0 = block.y;
  const x1 = x0 + block.width;
  const y1 = y0 + block.height;
  const nx = clamp(local.x, x0, x1);
  const ny = clamp(local.y, y0, y1);
  const gap = Math.hypot(local.x - nx, local.y - ny);
  if (gap >= SEAT_RADIUS) return null;
  // поряд із рамкою, але в смузі запасу — відсуваємо тим самим напрямком
  if (gap > 0) {
    const k = SEAT_RADIUS / gap;
    return { x: nx + (local.x - nx) * k, y: ny + (local.y - ny) * k };
  }
  // всередині: через найближчу з чотирьох сторін. Саме тут і ховалась помилка —
  // раніше звідси виходили кільцевим пошуком на 8 кілець, і з великого обʼєкта
  // він просто не діставав до межі (журнал 06.10)
  const toLeft = local.x - x0;
  const toRight = x1 - local.x;
  const toTop = local.y - y0;
  const toBottom = y1 - local.y;
  const best = Math.min(toLeft, toRight, toTop, toBottom);
  if (best === toLeft) return { x: x0 - SEAT_RADIUS, y: local.y };
  if (best === toRight) return { x: x1 + SEAT_RADIUS, y: local.y };
  if (best === toTop) return { x: local.x, y: y0 - SEAT_RADIUS };
  return { x: local.x, y: y1 + SEAT_RADIUS };
}

// те саме для еліпса: роздуваємо півосі на запас і виходимо назовні по промені
// з центру. Запас точний лише по осях, по діагоналі трохи щедріший — для
// «не сідати зверху» цього досить, а точна найближча точка еліпса рахується
// лише ітераціями
function exitEllipse(local: Point, block: SeatBlock): Point | null {
  const cx = block.x + block.width / 2;
  const cy = block.y + block.height / 2;
  const a = block.width / 2 + SEAT_RADIUS;
  const b = block.height / 2 + SEAT_RADIUS;
  const qx = (local.x - cx) / a;
  const qy = (local.y - cy) / b;
  const q = Math.hypot(qx, qy);
  if (q >= 1) return null;
  // рівно в центрі напрямок невизначений — беремо вбік по x
  if (q === 0) return { x: cx + a, y: cy };
  return { x: cx + (qx / q) * a, y: cy + (qy / q) * b };
}

// куда вийти з цього обʼєкта; null — точка його не торкається. Одна функція й
// на перевірку, і на виштовхування: якби це були два різні обчислення, вони
// рано чи поздно розійшлись би, і виштовхнута точка лишалась би «зайнятою»
function exitOf(point: Point, block: SeatBlock): Point | null {
  const local = toLocal(point, block);
  const out = isEllipse(block) ? exitEllipse(local, block) : exitBox(local, block);
  return out && toWorld(out, block);
}

function isFree(point: Point, taken: Point[], walls: SeatBlock[]) {
  for (const seat of taken) {
    if (Math.hypot(point.x - seat.x, point.y - seat.y) < SEAT_MIN_GAP) return false;
  }
  return !walls.some((block) => exitOf(point, block) !== null);
}

// з усього, що накрило точку, виходимо найдешевшим кроком; null — вільно
function shortestExit(point: Point, walls: SeatBlock[]): Point | null {
  let best: Point | null = null;
  let bestGap = Infinity;
  for (const block of walls) {
    const exit = exitOf(point, block);
    if (!exit) continue;
    const gap = Math.hypot(exit.x - point.x, exit.y - point.y);
    if (gap < bestGap) {
      bestGap = gap;
      best = exit;
    }
  }
  return best;
}

// кілька обʼєктів, що перекриваються, можуть перекидати точку один в одного —
// тоді після цих кроків беремось за пошук по кільцях
const ESCAPE_STEPS = 12;
const RING_STEP = SEAT_MIN_GAP / 2;
const RING_SAMPLES = 16;
// скільки є сенс шукати вихід: далі найдальшого кута найбільшого обʼєкта
// блокувати вже нічому. Не стала константа — рахується з того, що на дошці
function wallSearchLimit(from: Point, walls: SeatBlock[]) {
  let limit = SEAT_MIN_GAP;
  for (const block of walls) {
    const cx = block.x + block.width / 2;
    const cy = block.y + block.height / 2;
    // пів діагоналі від повороту не залежить, тому поворот тут і не потрібен
    const reach =
      Math.hypot(from.x - cx, from.y - cy) + Math.hypot(block.width, block.height) / 2 + SEAT_RADIUS;
    limit = Math.max(limit, reach);
  }
  return limit + SEAT_MIN_GAP;
}
// запобіжник від вічного циклу; на 88 тисяч одиниць дошки нічого не схоже
const HARD_RINGS = 4000;
// розведення з чужими стільцями — не правило, а щоб імена читались, тому
// шукаємо поруч і не тягнемо стілець через пів дошки
const SPREAD_RINGS = 8;

function ringSearch(from: Point, taken: Point[], walls: SeatBlock[], rings: number) {
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring * RING_STEP;
    for (let i = 0; i < RING_SAMPLES; i++) {
      // кожне кільце трохи провернуте — інакше всі промені лягають в один ряд
      const angle = (i / RING_SAMPLES) * Math.PI * 2 + ring * 0.4;
      const point = { x: from.x + Math.cos(angle) * radius, y: from.y + Math.sin(angle) * radius };
      if (isFree(point, taken, walls)) return point;
    }
  }
  return null;
}

// останній рубіж: вивести за габарити всього, що блокує. Сюди не має
// доходити ніколи, але вертати точку на обʼєкті — не варіант
function besideWalls(from: Point, walls: SeatBlock[]): Point {
  let maxX = from.x;
  for (const block of walls) {
    const pivot = pivotOf(block);
    const radians = radiansOf(block);
    for (const corner of [
      { x: block.x, y: block.y },
      { x: block.x + block.width, y: block.y },
      { x: block.x, y: block.y + block.height },
      { x: block.x + block.width, y: block.y + block.height },
    ]) {
      maxX = Math.max(maxX, spin(corner, pivot, radians).x);
    }
  }
  return { x: maxX + SEAT_RADIUS + 1, y: from.y };
}

// гарантовано точка поза всіма обʼєктами, що блокують
function outOfWalls(drop: Point, walls: SeatBlock[]): Point {
  let point = drop;
  for (let step = 0; step < ESCAPE_STEPS; step++) {
    const exit = shortestExit(point, walls);
    if (!exit) return point;
    point = exit;
  }
  const rings = Math.min(Math.ceil(wallSearchLimit(drop, walls) / RING_STEP), HARD_RINGS);
  return ringSearch(drop, [], walls, rings) ?? besideWalls(drop, walls);
}

// куди відпустили — туди й сідаємо, якщо там вільно. Якщо ні — спершу виходимо
// з обʼєктів, на яких сидіти не дозволено (це правило, і воно мусить виконатись
// при будь-якому розмірі обʼєкта), а потім, якщо виходить, відсуваємось і від
// чужих стільців. Коли поруч усе зайняте — лишаємось поза обʼєктами, хай і
// близько до сусіда: злиплі кружечки це нечитані імена, а стілець на обʼєкті —
// порушена домовленість
export function nearestFreeSeat(drop: Point, taken: Point[], blocks: SeatBlock[] = []): Point {
  const walls = blocks.filter(blocksSeat);
  if (isFree(drop, taken, walls)) return drop;

  const escaped = outOfWalls(drop, walls);
  if (isFree(escaped, taken, walls)) return escaped;

  return ringSearch(escaped, taken, walls, SPREAD_RINGS) ?? escaped;
}
