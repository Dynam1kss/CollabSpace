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
const SEAT_RADIUS = 18;
// два стільці вважаємо розсунутими, коли кола не торкаються
export const SEAT_MIN_GAP = SEAT_RADIUS * 2 + 8;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  // обʼєкт, на який дозволено сідати, для пошуку місця не існує
  seatsAllowed?: boolean;
}

function hitsRect(point: { x: number; y: number }, rect: Rect) {
  // найближча точка прямокутника до центра кола; поворот обʼєкта свідомо
  // ігноруємо — для «не сідати зверху» досить описаної рамки
  const nx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const ny = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - nx, point.y - ny) < SEAT_RADIUS;
}

function isFree(point: { x: number; y: number }, taken: { x: number; y: number }[], blocks: Rect[]) {
  for (const seat of taken) {
    if (Math.hypot(point.x - seat.x, point.y - seat.y) < SEAT_MIN_GAP) return false;
  }
  return !blocks.some((rect) => !rect.seatsAllowed && hitsRect(point, rect));
}

// куди відпустили — туди й сідаємо, якщо там вільно. Якщо ні — шукаємо
// найближче вільне, розкручуючись від точки скидання кільцями. Не забороняємо
// саме скидання: людина вже показала, куди хоче, лишається посунути на
// найменшу відстань, щоб імена читались
export function nearestFreeSeat(
  drop: { x: number; y: number },
  taken: { x: number; y: number }[],
  blocks: Rect[] = [],
) {
  if (isFree(drop, taken, blocks)) return drop;

  const STEPS = 16;
  for (let ring = 1; ring <= 8; ring++) {
    const radius = ring * (SEAT_MIN_GAP / 2);
    for (let i = 0; i < STEPS; i++) {
      // кожне кільце трохи провернуте — інакше всі промені лягають в один ряд
      const angle = (i / STEPS) * Math.PI * 2 + ring * 0.4;
      const point = { x: drop.x + Math.cos(angle) * radius, y: drop.y + Math.sin(angle) * radius };
      if (isFree(point, taken, blocks)) return point;
    }
  }
  // навколо все зайняте — краще лишити там, куди поклали, ніж відкинути кудись
  return drop;
}
