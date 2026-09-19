import { CURSOR_BYTES, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { ViewportMessage } from 'shared';

// присутність шле через той самий сокет, що й документ — useBoardSync ставить
// сюди свій send, коли відкриває зʼєднання, і знімає на розриві. Модульна
// змінна, а не проп: курсор народжується в BoardCanvas, а виділення — у
// підписці на editor-store, тягнути сокет через обидва шляхи пропсами дорожче
let sendFrame: ((data: Uint8Array) => void) | null = null;

export function setPresenceSender(fn: ((data: Uint8Array) => void) | null) {
  sendFrame = fn;
  if (!fn) {
    cursorPublisher.cancel();
    viewportPublisher.cancel();
    lastViewport = null;
  }
}

// ~18 кадрів на секунду. Курсор — не документ: втрачений кадр перекриється
// наступним, тому шлемо не на кожен mousemove, а по таймеру. Останнє
// положення доходить завжди — таймер із хвостом, а не простий «не частіше ніж»
export const CURSOR_THROTTLE_MS = 55;

// ~8 на секунду — удвічі рідше за курсор. Вікно їде цілим прямокутником у
// пів екрана завширшки, і крок на ньому помітно менш помітний, ніж на вістрі
// курсора: у сусіда рамка зсувається на ту саму частку своєї ширини за крок,
// тобто відносний ривок у десятки разів менший. Тому інтерполяції, як у
// RemoteCursors, тут нема — рамка кладеться в стор як є
export const VIEWPORT_THROTTLE_MS = 120;

// спільне для курсора й вікна: тримає останнє значення і випускає його не
// частіше ніж раз на intervalMs, але випускає обовʼязково — хвостовий таймер,
// інакше остання точка жесту так і не дійшла б
function throttledPublisher<T>(intervalMs: number, build: (value: T) => Uint8Array) {
  let pending: T | null = null;
  let lastSentAt = 0;
  let timer: number | undefined;

  function flush() {
    timer = undefined;
    const value = pending;
    pending = null;
    if (value === null || !sendFrame) return;
    lastSentAt = Date.now();
    sendFrame(build(value));
  }

  return {
    publish(value: T) {
      pending = value;
      if (timer !== undefined) return;
      timer = window.setTimeout(flush, Math.max(0, intervalMs - (Date.now() - lastSentAt)));
    },
    cancel() {
      pending = null;
      window.clearTimeout(timer);
      timer = undefined;
    },
  };
}

function jsonFrame(type: number, payload: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(1 + body.length);
  frame[0] = type;
  frame.set(body, 1);
  return frame;
}

const cursorPublisher = throttledPublisher<{ x: number; y: number }>(CURSOR_THROTTLE_MS, (point) => {
  // [тип][x:f32][y:f32] — id відправника допише сервер
  const frame = new Uint8Array(1 + CURSOR_BYTES - SYNC_REQUESTER_ID_BYTES);
  frame[0] = SYNC_MSG.CURSOR;
  const view = new DataView(frame.buffer);
  view.setFloat32(1, point.x);
  view.setFloat32(5, point.y);
  return frame;
});

const viewportPublisher = throttledPublisher<ViewportMessage>(VIEWPORT_THROTTLE_MS, (rect) =>
  jsonFrame(SYNC_MSG.VIEWPORT, rect),
);

export function publishCursor(point: { x: number; y: number }) {
  cursorPublisher.publish(point);
}

// виділення міняється рідко (клік, рамка, ctrl+a) — тут тротлінг ні до чого
export function publishSelection(selectedIds: string[]) {
  if (!sendFrame) return;
  sendFrame(jsonFrame(SYNC_MSG.SELECTION, selectedIds));
}

// замок на редагування тексту — так само рідкий кадр, як і виділення:
// заходиш у текст і виходиш, тротлити нема чого
export function publishLock(objectId: string | null) {
  if (!sendFrame) return;
  sendFrame(jsonFrame(SYNC_MSG.LOCK, { objectId }));
}

// останнє надіслане вікно — щоб переспівати його новачкові: він міг зайти
// тоді, коли телефон уже хвилину лежить нерухомо, і кадру не буде ще довго
let lastViewport: ViewportMessage | null = null;

export function publishViewport(rect: ViewportMessage) {
  lastViewport = rect;
  viewportPublisher.publish(rect);
}

export function republishViewport() {
  if (lastViewport) publishViewport(lastViewport);
}
