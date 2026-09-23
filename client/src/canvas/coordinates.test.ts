import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, boardToScreen, centerOnPoint, screenToBoard } from './coordinates';

describe('centerOnPoint', () => {
  it('задана точка дошки опиняється рівно посеред екрана', () => {
    const vp = centerOnPoint({ x: 300, y: -120 }, 1.5, 800, 600);
    const onScreen = boardToScreen({ x: 300, y: -120 }, vp);
    expect(onScreen.x).toBeCloseTo(400, 6);
    expect(onScreen.y).toBeCloseTo(300, 6);
  });

  it('масштаб затискається в дозволені межі', () => {
    expect(centerOnPoint({ x: 0, y: 0 }, 99, 800, 600).scale).toBe(MAX_SCALE);
    expect(centerOnPoint({ x: 0, y: 0 }, 0.0001, 800, 600).scale).toBe(MIN_SCALE);
  });
});

// саме це й ламалось: у тілі SHOW_VIEW їхав екранний зсув відправника, а він
// має сенс лише разом із розміром ЙОГО вікна
describe('«подивіться, де я» між різними екранами', () => {
  const sender = { screen: { w: 1280, h: 800 }, viewport: { x: -420, y: 260, scale: 1.4 } };
  const receivers = [
    ['телефон', 412, 839],
    ['менше вікно на десктопі', 900, 520],
    ['той самий розмір', 1280, 800],
  ] as const;

  // що в відправника посеред екрана, у координатах дошки
  const sent = screenToBoard({ x: sender.screen.w / 2, y: sender.screen.h / 2 }, sender.viewport);

  for (const [name, w, h] of receivers) {
    it(`${name}: та сама точка дошки лягає в центр екрана глядача`, () => {
      const applied = centerOnPoint(sent, sender.viewport.scale, w, h);
      const onScreen = boardToScreen(sent, applied);
      expect(onScreen.x).toBeCloseTo(w / 2, 6);
      expect(onScreen.y).toBeCloseTo(h / 2, 6);
    });
  }

  it('масштаб відправника доїжджає без змін', () => {
    expect(centerOnPoint(sent, sender.viewport.scale, 412, 839).scale).toBe(sender.viewport.scale);
  });

  it('старий шлях (переслати viewport.x/y як є) на іншому екрані промахувався', () => {
    // так було до фікса: глядач ставив собі чужий зсув
    const asBefore = boardToScreen(sent, sender.viewport);
    // у відправника це центр його екрана…
    expect(asBefore.x).toBeCloseTo(640, 6);
    // …а в глядача з екраном 412x839 центр зовсім в іншому місці
    expect(Math.abs(asBefore.x - 412 / 2)).toBeGreaterThan(400);
  });
});
