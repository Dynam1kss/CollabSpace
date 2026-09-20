import { describe, expect, it } from 'vitest';
import type { Box } from 'konva/lib/shapes/Transformer';
import { MIN_SIZE, bakedSide, fixedCornerOf, limitBoxSize, scaledStrokeWidth } from './transform-math';

const box = (x: number, width: number, y = 0, height = 80): Box => ({ x, y, width, height, rotation: 0 });

// konva віддає рамку РАЗОМ З обведенням — через це «нерухомий» кінець, якщо
// шукати його наново щокадру, повзе на піваобведення за кадр. Саме ця
// дрібниця й перетворювала повільний перетин на тягання всієї фігури
const inflated = (b: Box, by: number): Box => ({
  ...b,
  x: b.x - by,
  y: b.y - by,
  width: b.width + by * 2,
  height: b.height + by * 2,
});

// один жест: ручка, початкова рамка й послідовність позицій курсора по x.
// Щокадру відтворюємо те, що робить konva: рухому ручку ставить у курсор,
// другу лишає там, де рамка стоїть зараз. inflate — обведення, яке konva
// домішує до рамки: воно зсуває нерухомий кут на сталу величину, тому
// перевіряємо не абсолютні числа, а те, що кадри збігаються між собою
function dragFrames(anchor: string, start: Box, cursors: number[], inflate = 0) {
  const fixed = fixedCornerOf(inflated(start, inflate), anchor);
  let node = start;
  const frames: Box[] = [];
  for (const cursor of cursors) {
    const oldBox = inflated(node, inflate);
    const newBox = anchor.includes('right')
      ? { ...oldBox, width: cursor - oldBox.x }
      : { ...oldBox, x: cursor, width: oldBox.x + oldBox.width - cursor };
    const out = limitBoxSize(fixed, newBox);
    frames.push(out);
    // назад у геометрію вузла: обведення konva домішує щокадру заново
    node = inflated(out, -inflate);
  }
  return { frames, fixed };
}

const same = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.width - b.width) < 1e-6 &&
  Math.abs(a.height - b.height) < 1e-6;

describe('нерухомий кут жесту', () => {
  it('протилежний до взятої ручки', () => {
    const b = box(100, 200, 50, 80);
    expect(fixedCornerOf(b, 'bottom-right')).toMatchObject({ x: 100, y: 50 });
    expect(fixedCornerOf(b, 'top-left')).toMatchObject({ x: 300, y: 130 });
    expect(fixedCornerOf(b, 'top-right')).toMatchObject({ x: 100, y: 130 });
    expect(fixedCornerOf(b, 'middle-right')).toMatchObject({ x: 100, y: 50 });
  });
});

describe('приніжна зона: завмирає ВСЯ рамка, не лише розмір', () => {
  // саме цього бракувало: старі перевірки дивились тільки на width/height,
  // і зсув рамки проходив повз них
  it('тягнучи правий нижній кут — позиція теж не міняється', () => {
    const { frames } = dragFrames('bottom-right', box(0, 200), [7, 3, 6, 1, 5, 2, 7.9]);
    for (const f of frames) {
      expect(f.width).toBe(MIN_SIZE);
      expect(f.x).toBe(0);
    }
    expect(frames.every((f) => same(f, frames[0]))).toBe(true);
  });

  it('тягнучи ЛІВИЙ верхній — так само (саме тут воно і їхало)', () => {
    const { frames } = dragFrames('top-left', box(0, 200), [195, 197, 193, 199, 194, 198]);
    for (const f of frames) {
      expect(f.width).toBe(MIN_SIZE);
      expect(f.x + f.width).toBeCloseTo(200, 6);
    }
    expect(frames.every((f) => same(f, frames[0]))).toBe(true);
  });

  // з обведенням: у продакшені konva додає його до рамки щокадру
  it('не їде навіть коли рамка приходить роздутою обведенням', () => {
    for (const anchor of ['bottom-right', 'top-left']) {
      const cursors =
        anchor === 'bottom-right'
          ? [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]
          : [193, 194, 195, 196, 197, 198, 199, 198, 197, 196, 195, 194, 193];
      const { frames, fixed } = dragFrames(anchor, box(0, 200), cursors, 1);
      expect(frames.every((f) => same(f, frames[0]))).toBe(true);
      // і спирається саме на свій нерухомий кут
      const edge = anchor.includes('right') ? frames[0].x : frames[0].x + frames[0].width;
      expect(edge).toBeCloseTo(fixed.x, 6);
    }
  });

  // довгий повільний підхід по 1px: раніше тут набігали десятки пікселів
  it('сто дрібних кроків усередині зони не зсувають рамку ні на піксель', () => {
    const cursors: number[] = [];
    for (let i = 0; i < 100; i++) cursors.push(195 + (i % 5));
    const { frames, fixed } = dragFrames('top-left', box(0, 200), cursors, 1);
    expect(frames.every((f) => same(f, frames[0]))).toBe(true);
    const last = frames[frames.length - 1];
    expect(last.x + last.width).toBeCloseTo(fixed.x, 6);
  });
});

describe('перетин нерухомого кута', () => {
  it('щойно курсор перейшов кут — фігура вже з іншого боку', () => {
    const { frames } = dragFrames('bottom-right', box(0, 200), [3, -3]);
    expect(frames[0]).toMatchObject({ x: 0, width: MIN_SIZE });
    expect(frames[1]).toMatchObject({ x: -MIN_SIZE, width: MIN_SIZE });
  });

  it('стрибок одразу далеко за кут дає повний розмір тієї ж миті', () => {
    const [f] = dragFrames('bottom-right', box(0, 200), [-240]).frames;
    expect(f.width).toBe(240);
    expect(f.x).toBe(-240);
  });

  it('те саме для лівої ручки', () => {
    const { frames } = dragFrames('top-left', box(0, 200), [197, 203, 320]);
    expect(frames[0]).toMatchObject({ width: MIN_SIZE });
    expect(frames[0].x + frames[0].width).toBeCloseTo(200, 6);
    expect(frames[1]).toMatchObject({ width: MIN_SIZE, x: 200 });
    expect(frames[2]).toMatchObject({ width: 120, x: 200 });
  });

  it('далі за кутом розмір іде за курсором без відставання', () => {
    const cursors = [-9, -20, -75, -240];
    const { frames } = dragFrames('bottom-right', box(0, 200), cursors);
    frames.forEach((f, i) => {
      expect(f.width).toBeCloseTo(Math.abs(cursors[i]), 6);
      expect(f.x).toBeCloseTo(cursors[i], 6);
    });
  });

  it('нерухомий кут стоїть на місці на всьому жесті — і до, і після перетину', () => {
    const cursors = [200, 120, 40, 12, 8, 4, 1, -1, -4, -8, -12, -40, -120, -200];
    const { frames, fixed } = dragFrames('bottom-right', box(0, 200), cursors, 1);
    for (const f of frames) {
      const fixedEnd = f.x < fixed.x ? f.x + f.width : f.x;
      expect(fixedEnd).toBeCloseTo(fixed.x, 6);
    }
  });
});

describe('поворот рамки', () => {
  it('зсув іде вздовж осей самої рамки', () => {
    const turned: Box = { x: 100, y: 200, width: 262, height: 180, rotation: Math.PI / 2 };
    const fixed = fixedCornerOf(turned, 'bottom-right');
    const out = limitBoxSize(fixed, { ...turned, width: -300 });
    expect(out.width).toBe(300);
    expect(out.x).toBeCloseTo(100, 6);
    expect(out.y).toBeCloseTo(-100, 6);
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

  it('не накопичується за багато кадрів із проходом крізь нуль', () => {
    const start = { strokeWidth: 2, width: 260, height: 160 };
    const frames = [200, 120, 60, 20, MIN_SIZE, MIN_SIZE, 20, 60, 120, 200, 260];
    let last = 0;
    for (const w of frames) {
      last = scaledStrokeWidth(start, { width: w, height: (w / 260) * 160 });
      expect(last).toBeLessThan(20);
    }
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
