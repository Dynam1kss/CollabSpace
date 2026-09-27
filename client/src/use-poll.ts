import { useEffect, useRef } from 'react';

// при поверненні на вкладку приходять і visibilitychange, і focus — другий
// запит за секунду нічого нового не скаже
const REFOCUS_DEDUP_MS = 1000;

// періодично смикає fn, поки компонент живий, і одразу — коли людина
// повертається на вкладку. у фоні не ходимо: там однаково ніхто не дивиться
export function usePoll(fn: () => void, intervalMs: number) {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let lastRun = performance.now();
    const run = () => {
      if (document.hidden) return;
      lastRun = performance.now();
      fnRef.current();
    };
    const runOnReturn = () => {
      if (performance.now() - lastRun < REFOCUS_DEDUP_MS) return;
      run();
    };

    const id = window.setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', runOnReturn);
    window.addEventListener('focus', runOnReturn);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', runOnReturn);
      window.removeEventListener('focus', runOnReturn);
    };
  }, [intervalMs]);
}
