import type Konva from 'konva';

// кадри присутності приходять рідко — раз на тротлінг відправника. Якщо класти
// їх у вузол як є, рух виходить рваний: стільки кроків на секунду, скільки
// кадрів. Тому між двома останніми отриманими значеннями доїжджаємо самі, по
// rAF, за той самий інтервал, з яким вони приходять. React у цьому не бере
// участі: числа виставляються руками по вузлу konva, інакше довелось би
// перемальовувати компонент 60 разів на секунду. Свого курсора це не
// стосується — його малює браузер
interface Track {
  from: number[];
  to: number[];
  start: number;
  duration: number;
}

// доїзд коротший за це не має сенсу — це вже менше за кадр
const MIN_TWEEN_MS = 16;

interface Tween {
  // ref для вузла учасника; кешується за clientId, бо нова функція на кожен
  // рендер змушувала б React відчіпляти й чіпляти вузол щокадру
  ref: (clientId: number) => (node: Konva.Node | null) => void;
  // нові цілі з мережі
  retarget: (targets: Record<number, number[]>) => void;
  // перемалювати з поточними значеннями, не чіпаючи цілей — коли змінилось
  // щось моє, а не їхнє (мій масштаб, моє видиме вікно)
  refresh: () => void;
  stop: () => void;
}

// durationMs — не жорстка тривалість, а орієнтир: реальний інтервал між
// кадрами міряємо самі (див. retarget), бо відправник міняє темп, а таймер на
// завантаженій вкладці ще й плаває
export function createPresenceTween(
  durationMs: number,
  apply: (node: Konva.Node, values: number[]) => void,
): Tween {
  const nodes = new Map<number, Konva.Node>();
  const refs = new Map<number, (node: Konva.Node | null) => void>();
  const current = new Map<number, number[]>();
  const tracks = new Map<number, Track>();
  const lastArrival = new Map<number, number>();
  let raf: number | null = null;

  function paint(clientId: number, values: number[]) {
    const node = nodes.get(clientId);
    // вузол ще не змонтований — значення не запам'ятовуємо, наступний кадр
    // поставить його першим разом, без доїзду нізвідки
    if (!node) return null;
    current.set(clientId, values);
    apply(node, values);
    return node.getLayer();
  }

  function step() {
    raf = null;
    const now = performance.now();
    let layer: Konva.Layer | null = null;
    for (const [clientId, track] of tracks) {
      const k = Math.min(1, (now - track.start) / track.duration);
      const values = track.from.map((from, i) => from + (track.to[i] - from) * k);
      layer = paint(clientId, values) ?? layer;
      if (k >= 1) tracks.delete(clientId);
    }
    layer?.batchDraw();
    if (tracks.size > 0) raf = requestAnimationFrame(step);
  }

  return {
    ref: (clientId) => {
      let fn = refs.get(clientId);
      if (!fn) {
        fn = (node) => {
          if (node) nodes.set(clientId, node);
          else nodes.delete(clientId);
        };
        refs.set(clientId, fn);
      }
      return fn;
    },

    retarget: (targets) => {
      for (const clientId of [...refs.keys()]) {
        if (clientId in targets) continue;
        refs.delete(clientId);
        tracks.delete(clientId);
        current.delete(clientId);
        lastArrival.delete(clientId);
      }
      const now = performance.now();
      let layer: Konva.Layer | null = null;
      for (const [key, values] of Object.entries(targets)) {
        const clientId = Number(key);
        const previous = lastArrival.get(clientId);
        lastArrival.set(clientId, now);
        const from = current.get(clientId);
        if (!from) {
          layer = paint(clientId, values) ?? layer;
          continue;
        }
        // їдемо рівно стільки, скільки реально минуло між кадрами. Фіксована
        // тривалість означала б або доїзд ривком і простій до наступного кадру
        // (саме це й робило курсор млявим під час тягання), або недоїзд.
        // Стеля — щоб після паузи в русі не повзти до нової точки секунду
        const gap = previous === undefined ? durationMs : now - previous;
        const duration = Math.min(durationMs * 1.5, Math.max(MIN_TWEEN_MS, gap));
        tracks.set(clientId, { from, to: values, start: now, duration });
      }
      layer?.batchDraw();
      if (tracks.size > 0 && raf === null) raf = requestAnimationFrame(step);
    },

    refresh: () => {
      let layer: Konva.Layer | null = null;
      for (const [clientId, values] of current) layer = paint(clientId, values) ?? layer;
      layer?.batchDraw();
    },

    stop: () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      tracks.clear();
    },
  };
}
