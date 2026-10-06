import { describe, expect, it } from 'vitest';
import type { LinkObject } from 'shared';
import { LINK_BADGE, LINK_BASE_WIDTH, linkBadgeHit, linkCardSize, linkLayout } from './link-layout';
import { gripFor, resizeFromPointer } from './objects/transform-math';

// рамка виділення й вміст картки мусять сходитись у будь-якому розмірі.
// Розʼїжджались вони через невидиму зону влучання значка «відкрити»: у
// координатах картки вона росла, коли картка меншала, вилазила за її межі,
// і рамка починала рахуватись по ній (журнал 06.10)

const card = (over: Partial<LinkObject> = {}): LinkObject => {
  const base: LinkObject = {
    id: 'k',
    type: 'link',
    x: 100,
    y: 100,
    width: LINK_BASE_WIDTH,
    height: 0,
    rotation: 0,
    zIndex: 0,
    createdBy: 'u',
    createdAt: '2026-10-06T00:00:00.000Z',
    url: 'https://example.com/',
    ...over,
  };
  return { ...base, ...linkCardSize(base) };
};

describe('картка посилання: рамка й вміст в одному розмірі', () => {
  it('зона влучання значка ніколи не вилазить за межі картки', () => {
    for (const object of [card(), card({ url: 'https://youtu.be/dQw4w9WgXcQ' })]) {
      const height = linkLayout(object).height;
      // від звичайного масштабу до дуже дрібного — саме там вона й роздувалась
      for (const screenScale of [4, 1, 0.5, 0.25, 0.1, 0.02]) {
        const hit = linkBadgeHit(height, screenScale);
        const where = `${object.url} @${screenScale}`;
        expect(hit.x, where).toBeGreaterThanOrEqual(0);
        expect(hit.y, where).toBeGreaterThanOrEqual(0);
        expect(hit.x + hit.size, where).toBeLessThanOrEqual(LINK_BASE_WIDTH);
        expect(hit.y + hit.size, where).toBeLessThanOrEqual(height);
        // і при цьому не менша за сам значок
        expect(hit.size, where).toBeGreaterThanOrEqual(Math.min(LINK_BADGE, height));
      }
    }
  });

  it('на великій картці зона влучання таки дає 44px на екрані', () => {
    const object = card({ url: 'https://youtu.be/dQw4w9WgXcQ' });
    const height = linkLayout(object).height;
    // масштаб 1: 44 одиниці картки — це 44px
    expect(linkBadgeHit(height, 1).size).toBe(44);
  });

  it('стискання за кут до мінімуму: нерухомий кут на місці, розмір — рівно вміст', () => {
    for (const object of [
      card(),
      card({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
      card({ url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }),
    ]) {
      const rect = { x: object.x, y: object.y, width: object.width, height: object.height };
      // тягнемо правий нижній кут майже в лівий верхній — далі мінімуму не дасть
      const grip = gripFor(rect, 0, 'bottom-right');
      const box = resizeFromPointer(grip, { x: rect.x + 1, y: rect.y + 1 }, true);
      const patch = linkCardSize(object, box.width);
      const where = object.url;

      // нерухомий кут — там, де й був
      expect(box.x, where).toBeCloseTo(rect.x, 6);
      expect(box.y, where).toBeCloseTo(rect.y, 6);
      // висота картки — не з рамки, а з вмісту; і це те саме число
      expect(patch.height, where).toBe(Math.round(linkLayout(object).height * (box.width / LINK_BASE_WIDTH)));
      // пропорція збережена: рамка й вміст не можуть розійтись
      expect(patch.width / patch.height, where).toBeCloseTo(object.width / object.height, 1);
      expect(box.height, where).toBeCloseTo(patch.height, 0);
    }
  });
});
