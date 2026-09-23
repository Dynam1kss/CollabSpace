import type { Viewport } from './coordinates';
import { clampScale } from './coordinates';

// камеру переносить не власник екрана, а хтось інший («подивіться, де я»).
// Миттєвий стрибок у такому разі дезорієнтує: людина не натискала нічого і
// не зрозуміє, куди її кинуло. Тому доїзд, а не підстановка.
// «Показати все» лишається миттєвим — там стрибок ініціює сама людина
export const TRAVEL_MS = 420;

// масштаб ведемо геометрично (через логарифм), а не лінійно: 0.5 → 2 лінійно
// більшу частину шляху повзе біля двійки і смикається наприкінці
export function travelStep(from: Viewport, to: Viewport, t: number): Viewport {
  const k = ease(Math.min(1, Math.max(0, t)));
  const scale = clampScale(from.scale * Math.pow(to.scale / from.scale, k));
  return {
    scale,
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
  };
}

// easeInOutCubic — той самий профіль, що й у більшості переходів інтерфейсу
function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// доїзд по rAF. Повертає функцію скасування: новий кадр SHOW_VIEW або
// власний рух людини мають переривати попередній переїзд, інакше два
// доїзди тягнуть камеру в різні боки
export function travelTo(
  from: Viewport,
  to: Viewport,
  apply: (viewport: Viewport) => void,
  durationMs = TRAVEL_MS,
) {
  const start = performance.now();
  let raf = requestAnimationFrame(function step(now) {
    const t = (now - start) / durationMs;
    apply(travelStep(from, to, t));
    if (t < 1) raf = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(raf);
}
