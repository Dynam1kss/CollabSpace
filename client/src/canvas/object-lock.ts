import type { BoardObject } from 'shared';

// чи можна зараз рухати обʼєкт, міняти йому розмір і кут. Дві різні причини
// заборони, але для руки вони однакові: хтось інший у ньому зараз друкує
// (ефемерний замок присутності) або на ньому стоїть постійний прапорець
// locked. Одна функція на обидва місця — полотно і трансформер мусять
// вирішувати однаково, інакше ручки зʼявляються там, де тягати не можна
export function isMovable(object: BoardObject, lockedByOthers: Set<string>) {
  return !lockedByOthers.has(object.id) && !object.locked;
}

// кого з виділеного справді можна знести. Правило те саме, що на рух:
// зайняте іншим і замкнене лишається на місці, решта йде. Тримаємо поруч
// із isMovable, щоб кнопка кошика й клавіша Delete не розʼїхались із тим,
// що людина бачить на полотні
export function deletableIds(objects: (BoardObject | undefined)[], lockedByOthers: Set<string>) {
  return objects.filter((o): o is BoardObject => !!o && isMovable(o, lockedByOthers)).map((o) => o.id);
}
