import { describe, expect, it } from 'vitest';
import { CUTOFF, FULL_RANGE, seatDistance, spatialGain } from './spatial-gain';

describe('гучність від відстані', () => {
  it('поруч — повна гучність', () => {
    expect(spatialGain(0)).toBe(1);
    expect(spatialGain(FULL_RANGE)).toBe(1);
    expect(spatialGain(FULL_RANGE - 1)).toBe(1);
  });

  it('за межею — тиша, а не «ледь чутно»', () => {
    expect(spatialGain(CUTOFF)).toBe(0);
    expect(spatialGain(CUTOFF + 500)).toBe(0);
  });

  it('спадає монотонно й без стрибка на самій межі', () => {
    let previous = 1;
    for (let d = FULL_RANGE; d <= CUTOFF; d += 20) {
      const gain = spatialGain(d);
      expect(gain).toBeLessThanOrEqual(previous + 1e-9);
      previous = gain;
    }
    // підходимо до межі вже майже нечутними — клацу не буде
    expect(spatialGain(CUTOFF - 20)).toBeLessThan(0.01);
  });

  it('удвічі далі за межу чутності — помітно тихіше, але ще чутно', () => {
    const half = spatialGain(FULL_RANGE * 2);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.6);
  });

  it('безглузда відстань не ламає розрахунок', () => {
    expect(spatialGain(Number.NaN)).toBe(1);
    expect(spatialGain(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('відстань рахується по координатах дошки', () => {
    expect(seatDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
