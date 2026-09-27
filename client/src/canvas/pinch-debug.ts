// тимчасово, для трейсу з живого телефона: ?pinchdebug в адресі (читається
// раз на старті вкладки, далі можна ходити по застосунку). прибирати разом з
// PinchDebug.tsx, recordPinch у useCanvasViewport і <PinchDebug /> у BoardPage
export const PINCH_DEBUG = new URLSearchParams(window.location.search).has('pinchdebug');

interface PinchSample {
  t: number;
  // pan — рух одним пальцем (зокрема той, що лишився після щипка)
  kind: 'start' | 'move' | 'settle' | 'end' | 'pan';
  // хто саме пише у viewport: щоб у трейсі було видно, чи два обробники
  // не смикають камеру по черзі
  src: 'touch-pinch' | 'pinch-settle' | 'touch-pan' | 'wheel' | 'mouse-pan';
  // масштаб, від якого крок рахувався — має дорівнювати scale попереднього рядка
  base: number;
  raw: number;
  smooth: number;
  skipped: boolean;
  // mid — середня точка, якою реально зсунули камеру; rawMid — де пальці насправді
  midX: number;
  midY: number;
  rawMidX: number;
  rawMidY: number;
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
  const head = 't,src,kind,base,raw,smooth,skipped,midX,midY,rawMidX,rawMidY,scale,x,y';
  const rows = samples.map((s) =>
    [
      s.t.toFixed(1),
      s.src,
      s.kind,
      s.base.toFixed(5),
      s.raw.toFixed(2),
      s.smooth.toFixed(2),
      s.skipped ? 1 : 0,
      s.midX.toFixed(1),
      s.midY.toFixed(1),
      s.rawMidX.toFixed(1),
      s.rawMidY.toFixed(1),
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
