// тимчасово, для вимірювання провалів при завантаженні клітинок (стратегія 3):
// ?aoiperf в адресі, читається раз на старті вкладки. Звіт — window.aoiPerf().
// прибирати разом із викликами stage()/timed() в aoi-sync, cell-docs і board-store
export const AOI_PERF =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('aoiperf');

// snapshot — rest-запит знімка; seed — засів клітинки з нього; apply —
// Y.applyUpdate чужого оновлення; mirror — запис у zustand; paint — від запису
// в стор до наступного кадру, тобто малювання react+konva
type Stage = 'snapshot' | 'seed' | 'apply' | 'mirror' | 'paint';

interface Row {
  calls: number;
  ms: number;
  max: number;
}

const rows = new Map<Stage, Row>();
let longest = 0;
let longTasks = 0;
let observing = false;

function row(stage: Stage) {
  let r = rows.get(stage);
  if (!r) {
    r = { calls: 0, ms: 0, max: 0 };
    rows.set(stage, r);
  }
  return r;
}

export function stage(name: Stage, ms: number) {
  if (!AOI_PERF) return;
  const r = row(name);
  r.calls++;
  r.ms += ms;
  r.max = Math.max(r.max, ms);
}

export function timed<T>(name: Stage, fn: () => T): T {
  if (!AOI_PERF) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    stage(name, performance.now() - t0);
  }
}

export async function timedAsync<T>(name: Stage, fn: () => Promise<T>): Promise<T> {
  if (!AOI_PERF) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    stage(name, performance.now() - t0);
  }
}

// скільки від запису в стор до кадру, у якому це справді намалювалось.
// два rAF підряд: перший — ще до малювання цього кадру, другий — уже після
let paintPending = false;
export function markPaint() {
  if (!AOI_PERF || paintPending) return;
  paintPending = true;
  const t0 = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      paintPending = false;
      stage('paint', performance.now() - t0);
    }),
  );
}

function observe() {
  if (observing) return;
  observing = true;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks++;
        longest = Math.max(longest, entry.duration);
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // у firefox longtask немає — решта вимірів від цього не залежить
  }
}

export function aoiPerfReset() {
  rows.clear();
  longest = 0;
  longTasks = 0;
  observe();
}

export function aoiPerfReport() {
  return {
    stages: Object.fromEntries(
      [...rows].map(([k, v]) => [
        k,
        { calls: v.calls, ms: Math.round(v.ms * 10) / 10, max: Math.round(v.max * 10) / 10 },
      ]),
    ),
    longTasks,
    longestTask: Math.round(longest),
  };
}

if (AOI_PERF) {
  observe();
  Object.assign(window, { aoiPerf: aoiPerfReport, aoiPerfReset });
}
