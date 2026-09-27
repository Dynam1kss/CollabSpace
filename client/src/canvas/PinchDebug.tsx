import { useEffect, useState } from 'react';
import { clearSamples, downloadCsv, pinchSamples, subscribePinch } from './pinch-debug';

// оверлей трейсу щипка, див. pinch-debug.ts
export function PinchDebug() {
  const [, rerender] = useState(0);

  useEffect(() => subscribePinch(() => rerender((n) => n + 1)), []);

  const samples = pinchSamples();
  const last = samples.slice(-14);
  return (
    <div className="pinch-debug">
      <div>
        кадрів: {samples.length}{' '}
        <button type="button" onClick={downloadCsv}>
          csv
        </button>{' '}
        <button type="button" onClick={clearSamples}>
          очистити
        </button>
      </div>
      <pre>
        {'   Δt    raw smooth flag scale\n'}
        {last
          .map((s, i) => {
            const dt = i > 0 ? s.t - last[i - 1].t : 0;
            // x — мертва зона зʼїла крок, s — кадр без події, фільтр доїжджає сам
            const flag = s.skipped ? 'x' : s.kind === 'settle' ? 's' : ' ';
            const head =
              s.kind === 'start' || s.kind === 'end' ? s.kind.padStart(5) : dt.toFixed(0).padStart(5);
            return `${head} ${s.raw.toFixed(1).padStart(6)} ${s.smooth.toFixed(1).padStart(6)}  ${flag}   ${s.scale.toFixed(4)}`;
          })
          .join('\n')}
      </pre>
    </div>
  );
}
