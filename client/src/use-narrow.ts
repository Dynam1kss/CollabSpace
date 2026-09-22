import { useEffect, useState } from 'react';

// один поріг на всю мобільну верстку — те саме число стоїть і в App.css
export const NARROW_QUERY = '(max-width: 768px)';

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    // між першим рендером і підпискою екран могли повернути
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return narrow;
}
