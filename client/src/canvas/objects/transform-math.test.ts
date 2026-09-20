import { describe, expect, it } from 'vitest';
import { MIN_SIZE, bakedSide, limitBoxSize, scaledStrokeWidth } from './transform-math';

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height, rotation: 0 });

describe('нижня межа розміру', () => {
  // відʼємна сторона — це дзеркалення, тож кадр приймаємо. Але НЕ віддаємо
  // знак конві: саме з нього виростало подвійне дзеркалення на різкому маху
  it('відʼємну ширину приймає, але віддає нормалізованою', () => {
    const out = limitBoxSize(box(200, 80), box(-120, 80));
    expect(out.width).toBe(120);
    expect(out.x).toBe(-120);
    expect(out.height).toBe(80);
  });

  // кадр більше не відкидаємо: підтягуємо сторону до порога на тому боці,
  // де зараз курсор. Відкинутий кадр лишав фігуру стояти, поки курсор ішов
  // далі, і жест накопичував розбіжність
  it('вироджений кадр не відкидає, а кладе на поріг', () => {
    const prev = box(200, 80);
    expect(limitBoxSize(prev, box(3, 80))).toMatchObject({ width: MIN_SIZE, height: 80, x: 0 });
    expect(limitBoxSize(prev, box(-3, 80))).toMatchObject({ width: MIN_SIZE, height: 80, x: -MIN_SIZE });
    expect(limitBoxSize(prev, box(200, -2))).toMatchObject({ width: 200, height: MIN_SIZE, y: -MIN_SIZE });
  });
});

describe('запікання scale у розмір', () => {
  it('відʼємний scale дає додатний розмір тієї ж величини', () => {
    expect(bakedSide(100, -1.5)).toBe(150);
    expect(bakedSide(100, 1.5)).toBe(150);
  });

  it('нижче порога не опускається', () => {
    expect(bakedSide(100, -0.01)).toBe(MIN_SIZE);
  });
});

describe('товщина обведення при зміні розміру', () => {
  it('росте пропорційно до розміру', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 100, height: 100 }, { width: 200, height: 200 })).toBe(4);
  });

  // саме те, на що скаржились: кілька проходів повз протилежну ручку
  // підряд розганяли обведення до максимуму
  it('не накопичується за багато кадрів із проходом крізь нуль', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    // кадри одного жесту: стискання до порога, дзеркалення, ріст назад
    const frames = [200, 120, 60, 20, MIN_SIZE, MIN_SIZE, 20, 60, 120, 200, 260];
    let last = 0;
    for (const w of frames) {
      last = scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 });
      expect(last).toBeLessThan(20);
    }
    // повернулись у вихідний розмір — і товщина та сама, що була
    expect(last).toBe(2);
  });

  it('десять перетинів поспіль не впираються в максимум', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    for (let i = 0; i < 10; i++) {
      for (const w of [260, 40, MIN_SIZE, 40, 260]) {
        expect(scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 })).toBeLessThanOrEqual(2);
      }
    }
  });

  it('за межі допустимого не виходить', () => {
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 10, height: 10 }, { width: 5000, height: 5000 })).toBe(20);
    expect(scaledStrokeWidth({ strokeWidth: 2, width: 500, height: 500 }, { width: 8, height: 8 })).toBe(1);
  });
});

// РІЗКИЙ мах: одна подія миші з дельтою в сотні пікселів перестрибує
// приніжну зону цілком, і конва віддає одразу велику ВІДʼЄМНУ рамку.
// За модулем вона не вироджена, тому поріг її пропускає — і саме тут
// починався розвал: побачивши відʼємну ширину, конва перейменовує активну
// ручку І віддає відʼємний scale, який decompose() робить поворотом 180°.
// Два дзеркалення поспіль — і активною стає ручка, що мала стояти нерухомо
describe('різкий мах через нуль', () => {
  const fixed = { x: 429, y: 349 };
  // тягнуть правий нижній кут: початок рамки стоїть на нерухомому куті,
  // а ширина/висота — це відстань до курсора зі знаком. Саме так konva
  // і віддає рамку в цьому випадку, тому oldBox беремо з тим самим початком
  const atFixed = (w: number, h: number) => ({ ...box(w, h), x: fixed.x, y: fixed.y });
  const held = atFixed(262, 162);

  it('велику відʼємну рамку не відкидає, а нормалізує', () => {
    const out = limitBoxSize(held, atFixed(-300, -180));
    expect(out.width).toBe(300);
    expect(out.height).toBe(180);
    // початок переїхав на справжній лівий верхній кут
    expect(out.x).toBeCloseTo(129, 6);
    expect(out.y).toBeCloseTo(169, 6);
  });

  it('нерухомий кут лишається на місці й туди, і назад', () => {
    const a = limitBoxSize(held, atFixed(-300, -180));
    expect(a.x + a.width).toBeCloseTo(fixed.x, 6);
    expect(a.y + a.height).toBeCloseTo(fixed.y, 6);
    // і різко назад у плюс — початок рамки там само, на нерухомому куті
    const b = limitBoxSize(a, atFixed(300, 180));
    expect(b.x).toBeCloseTo(fixed.x, 6);
    expect(b.y).toBeCloseTo(fixed.y, 6);
    expect(b.width).toBe(300);
    expect(b.height).toBe(180);
  });

  it('десять різких махів поспіль не зсувають нерухомий кут', () => {
    let prev = held;
    for (let i = 0; i < 10; i++) {
      const back = limitBoxSize(prev, atFixed(-300, -180));
      expect(back.x + back.width).toBeCloseTo(fixed.x, 6);
      expect(back.y + back.height).toBeCloseTo(fixed.y, 6);
      expect(back.width).toBe(300);
      const forth = limitBoxSize(back, atFixed(300, 180));
      expect(forth.x).toBeCloseTo(fixed.x, 6);
      expect(forth.width).toBe(300);
      prev = forth;
    }
  });

  // саме цей інваріант і ламав подвійне дзеркалення
  it('назовні ніколи не виходить рамка з відʼємною стороною', () => {
    for (const w of [-900, -300, -9, -1, 1, 9, 300, 900]) {
      for (const h of [-900, -180, -9, -1, 1, 9, 180, 900]) {
        const out = limitBoxSize(held, atFixed(w, h));
        expect(out.width).toBeGreaterThanOrEqual(MIN_SIZE);
        expect(out.height).toBeGreaterThanOrEqual(MIN_SIZE);
      }
    }
  });

  it('при повороті зсув іде вздовж осей самої рамки', () => {
    // повернуто на 90°: відʼємна ширина тягне початок уздовж осі y
    const turned = { x: 100, y: 200, width: 262, height: 180, rotation: Math.PI / 2 };
    const out = limitBoxSize(turned, { ...turned, width: -300 });
    expect(out.width).toBe(300);
    expect(out.x).toBeCloseTo(100, 6);
    expect(out.y).toBeCloseTo(-100, 6);
  });

  it('вироджену сторону кладе на поріг і на великій дельті', () => {
    const out = limitBoxSize(held, atFixed(-3, -180));
    expect(out.width).toBe(MIN_SIZE);
    expect(out.height).toBe(180);
    // нерухомий кут на місці, фігура стоїть порогом ліворуч від нього
    expect(out.x + out.width).toBeCloseTo(fixed.x, 6);
  });
});

// поведінка як у miro: розмір — чиста функція від того, де курсор ЗАРАЗ
// відносно нерухомого кінця. box() тут — рамка з нерухомим ПОЧАТКОМ (так
// konva віддає її, коли тягнуть праву/нижню ручку), тому newBox.width і є
// та сама відстань зі знаком
describe('приніжна зона й миттєве дзеркалення', () => {
  const prev = box(200, 80);
  const widthAt = (d: number) => limitBoxSize(prev, box(d, 80)).width;
  // де починається сторона — від цього видно, на якому боці стоїть фігура
  const startAt = (d: number) => limitBoxSize(prev, box(d, 80)).x;

  it('у приніжній зоні розмір не міняється, хоч як водити курсором', () => {
    for (const d of [7.9, 6, 4, 2, 0.5]) expect(widthAt(d)).toBe(MIN_SIZE);
    // і назад тією ж зоною — так само нічого
    for (const d of [0.5, 3, 5, 7.9]) expect(widthAt(d)).toBe(MIN_SIZE);
  });

  it('те саме дзеркально, з іншого боку нерухомого кінця', () => {
    for (const d of [-7.9, -5, -2, -0.5]) expect(widthAt(d)).toBe(MIN_SIZE);
    // і стоїть вона весь час на тому боці, а не на початковому
    for (const d of [-7.9, -5, -0.5]) expect(startAt(d)).toBe(-MIN_SIZE);
  });

  it('перехід через нерухомий кінець одразу перекидає фігуру на інший бік', () => {
    expect(startAt(0.5)).toBe(0);
    expect(startAt(-0.5)).toBe(-MIN_SIZE);
    expect(widthAt(0.5)).toBe(widthAt(-0.5));
  });

  it('за порогом розмір іде за курсором без відставання', () => {
    for (const d of [9, 20, 75, 240]) {
      expect(widthAt(d)).toBe(d);
      expect(widthAt(-d)).toBe(d);
      expect(startAt(-d)).toBe(-d);
    }
  });

  // саме це й просили: перескочити нуль одразу далеко і побачити той розмір,
  // а не поріг, з якого фігура ще мала б доростати
  it('стрибок одразу далеко за нуль дає повний розмір тієї ж миті', () => {
    expect(widthAt(-240)).toBe(240);
    expect(startAt(-240)).toBe(-240);
  });

  it('нерухомий кінець не рухається ні в зоні, ні за нею', () => {
    for (const d of [200, 40, 8, 3, 0.5, -0.5, -3, -8, -40, -200]) {
      const out = limitBoxSize(prev, box(d, 80));
      const fixedEnd = d >= 0 ? out.x : out.x + out.width;
      expect(fixedEnd).toBeCloseTo(0, 6);
    }
  });

  it('коли нерухомий ДАЛЬНІЙ кінець (тягнуть ліву ручку), усе дзеркально', () => {
    // початок рамки зрушив — отже тягнуть лівий бік, нерухомий кінець правий
    const moved = (d: number) => limitBoxSize(box(200, 80), { ...box(d, 80), x: 200 - d });
    const near = moved(3);
    expect(near.width).toBe(MIN_SIZE);
    expect(near.x + near.width).toBeCloseTo(200, 6);
    // курсор перейшов кінець — фігура вже з іншого боку, того ж розміру
    const over = moved(-3);
    expect(over.width).toBe(MIN_SIZE);
    expect(over.x).toBeCloseTo(200, 6);
    // і далеко за ним — розмір рівно за курсором
    const far = moved(-120);
    expect(far.width).toBe(120);
    expect(far.x).toBeCloseTo(200, 6);
  });
});
