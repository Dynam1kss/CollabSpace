// тимчасово, для трейсу з живого телефона: ?pinchdebug в адресі (читається
// раз на старті вкладки, далі можна ходити по застосунку). прибирати разом з
// PinchDebug.tsx, recordPinch у useCanvasViewport і <PinchDebug /> у BoardPage
export const PINCH_DEBUG = new URLSearchParams(window.location.search).has('pinchdebug');

interface PinchSample {
  t: number;
  kind: 'start' | 'move' | 'settle' | 'end';
  raw: number;
  smooth: number;
  skipped: boolean;
  midX: number;
  midY: number;
  scale: number;
  x: number;
  y: number;
}

const MAX_SAMPLES = 3000;
const samples: PinchSample[] = [];
let onChange: (() => void) | null = null;

export function pinchSamples(): readonly PinchSample[] {
  return samples;
}

export function subscribePinch(fn: () => void) {
  onChange = fn;
  return () => {
    onChange = null;
  };
}

export function recordPinch(s: PinchSample) {
  if (!PINCH_DEBUG) return;
  samples.push(s);
  if (samples.length > MAX_SAMPLES) samples.shift();
  onChange?.();
}

export function clearSamples() {
  samples.length = 0;
  onChange?.();
}

// через файл, а не буфер обміну: clipboard на телефоні по http (lan-адреса) недоступний
export function downloadCsv() {
  const head = 't,kind,raw,smooth,skipped,midX,midY,scale,x,y';
  const rows = samples.map((s) =>
    [
      s.t.toFixed(1),
      s.kind,
      s.raw.toFixed(2),
      s.smooth.toFixed(2),
      s.skipped ? 1 : 0,
      s.midX.toFixed(1),
      s.midY.toFixed(1),
      s.scale.toFixed(5),
      s.x.toFixed(1),
      s.y.toFixed(1),
    ].join(','),
  );
  const url = URL.createObjectURL(new Blob([[head, ...rows].join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `pinch-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
