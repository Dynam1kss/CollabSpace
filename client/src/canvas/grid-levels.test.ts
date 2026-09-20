import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE } from './coordinates';
import { BASE_SPACING, FACTOR, FADE_IN_PX, alphaOfSpacing, gridLevels } from './grid-levels';

// масштаби від краю до краю, дрібним кроком
const sweep = (steps = 400) => {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    out.push(MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** (i / steps));
  }
  return out;
};

describe('рівні сітки', () => {
  it('крок на екрані завжди в робочому діапазоні — тому ліній не більшає', () => {
    for (const scale of sweep()) {
      const { fineSpacing, coarseSpacing } = gridLevels(scale);
      expect(fineSpacing * scale).toBeGreaterThanOrEqual(FADE_IN_PX - 1e-9);
      expect(fineSpacing * scale).toBeLessThan(FADE_IN_PX * FACTOR + 1e-9);
      expect(coarseSpacing * scale).toBeGreaterThanOrEqual(FADE_IN_PX * FACTOR - 1e-9);
      expect(coarseSpacing * scale).toBeLessThan(FADE_IN_PX * FACTOR * FACTOR + 1e-9);
    }
  });

  it('грубий рівень рівно вп\u02bcятеро більший за дрібний, і обидва — кратні опорному', () => {
    for (const scale of sweep(120)) {
      const { fineSpacing, coarseSpacing } = gridLevels(scale);
      expect(coarseSpacing / fineSpacing).toBeCloseTo(FACTOR, 9);
      const power = Math.log(fineSpacing / BASE_SPACING) / Math.log(FACTOR);
      expect(power).toBeCloseTo(Math.round(power), 9);
    }
  });

  it('прозорість дрібного рівня лишається в межах 0..1', () => {
    for (const scale of sweep()) {
      const { fineAlpha } = gridLevels(scale);
      expect(fineAlpha).toBeGreaterThanOrEqual(0);
      expect(fineAlpha).toBeLessThanOrEqual(1);
    }
  });

  // головне: жодна лінія не спалахує й не гасне ривком. Беремо конкретний
  // крок і ведемо зум крізь усі межі рівнів — прозорість саме цієї лінії
  // має мінятись дрібними кроками
  it('прозорість кожної лінії міняється плавно, без стрибків на межах рівнів', () => {
    const spacings = [BASE_SPACING / FACTOR, BASE_SPACING, BASE_SPACING * FACTOR, BASE_SPACING * FACTOR ** 2];
    const scales = sweep(2000);
    for (const spacing of spacings) {
      let prev = alphaOfSpacing(scales[0], spacing);
      for (const scale of scales.slice(1)) {
        const now = alphaOfSpacing(scale, spacing);
        expect(Math.abs(now - prev)).toBeLessThan(0.05);
        prev = now;
      }
    }
  });

  // на самій межі: рівень, що дозрів, віддає естафету — і сумарна картина
  // по обидва боки межі та сама
  it('на межі рівнів дрібний доходить до повної видимості, а не обривається', () => {
    // межа там, де крок дрібного рівня дорівнює FADE_IN_PX
    const boundary = FADE_IN_PX / (BASE_SPACING * FACTOR ** 0);
    const above = gridLevels(boundary * 1.001);
    const below = gridLevels(boundary * 0.999);
    expect(above.fineAlpha).toBeLessThan(0.01);
    expect(below.fineAlpha).toBeGreaterThan(0.99);
    // те, що було грубим, стало дрібним — крок той самий
    expect(below.fineSpacing).toBeCloseTo(above.coarseSpacing, 9);
  });

  it('на новому мінімумі зуму рівні визначені й розумні', () => {
    const { fineSpacing, coarseSpacing } = gridLevels(MIN_SCALE);
    expect(fineSpacing * MIN_SCALE).toBeGreaterThanOrEqual(FADE_IN_PX);
    expect(coarseSpacing).toBeGreaterThan(fineSpacing);
  });
});
