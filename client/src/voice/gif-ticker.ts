import type Konva from 'konva';

// konva (як і drawImage за стандартом) малює з анімованої картинки лише
// перший кадр. тому кадри gif-стільців міняємо самі: один таймер на всіх,
// живе, поки на екрані є хоч один такий стілець, і зникає разом з останнім.
// 50мс — удвічі частіше за типову затримку кадру gif, щоб не губити короткі
const GIF_TICK_MS = 50;

interface Entry {
  layer: Konva.Layer;
  // виставляє потрібний на цей момент кадр; true — кадр змінився і шар
  // треба перемалювати (перемальовує вже таймер, раз на шар)
  tick: (now: number) => boolean;
}

const entries = new Set<Entry>();
let timer: ReturnType<typeof setInterval> | null = null;

export function watchGif(layer: Konva.Layer, tick: (now: number) => boolean) {
  const entry = { layer, tick };
  entries.add(entry);
  if (timer === null) {
    timer = setInterval(() => {
      const now = performance.now();
      const layers = new Set<Konva.Layer>();
      entries.forEach((e) => {
        if (e.tick(now)) layers.add(e.layer);
      });
      layers.forEach((l) => l.batchDraw());
    }, GIF_TICK_MS);
  }
  return () => {
    entries.delete(entry);
    if (entries.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// скільки gif-стільців зараз гортається — для перевірки, що таймер справді зупиняється
export function gifsWatched() {
  return entries.size;
}
