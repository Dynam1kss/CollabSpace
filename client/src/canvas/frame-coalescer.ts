import { syncStrategy } from './sync-strategy';

// у vitest rAF немає — там мікротаска, як і в черзі стору
const nextFrame: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame : queueMicrotask;

// «зробити це раз на кадр»: скільки б подій не прийшло між кадрами, виконається
// лише остання запланована дія, у наступному кадрі. для жестів, які самі пишуть
// у стор і одразу скидають у документ (ресайз, поворот трансформером) — інакше
// там пакет на кожну подію вказівника. у стратегії per-event — одразу, як було
export function frameCoalescer() {
  let pending: (() => void) | null = null;
  let scheduled = false;

  function run() {
    scheduled = false;
    const fn = pending;
    pending = null;
    fn?.();
  }

  return {
    schedule(fn: () => void) {
      if (syncStrategy() === 'per-event') {
        fn();
        return;
      }
      pending = fn;
      if (scheduled) return;
      scheduled = true;
      nextFrame(() => {
        // flush міг уже виконати й зняти чергу — тоді кадру нічого робити
        if (scheduled) run();
      });
    },
    // кінець жесту: відкладене — зараз, не чекаючи кадру
    flush() {
      if (scheduled) run();
    },
  };
}
