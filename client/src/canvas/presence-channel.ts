import { CURSOR_BYTES, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { ViewportMessage } from 'shared';
import { useEditorStore } from './editor-store';

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

// поки триває жест, курсор шлемо з тією самою частотою, з якою в документ
// їде сам обʼєкт — раз на кадр. Інакше два канали розʼїжджаються: обʼєкт
// оновлюється щокадру, курсор раз на 55мс, і вістря помітно тягнеться за
// тим, що нібито тримає (заміряно 140мс відставання)
export const CURSOR_DRAG_THROTTLE_MS = 16;

// ~8 на секунду — удвічі рідше за курсор. Вікно їде цілим прямокутником у
// пів екрана завширшки, тому й кадрів треба менше; плавність добирає доїзд
// на боці того, хто дивиться (RemoteViewports)
export const VIEWPORT_THROTTLE_MS = 120;

// спільне для курсора й вікна: тримає останнє значення і випускає його не
// частіше ніж раз на intervalMs, але випускає обовʼязково — хвостовий таймер,
// інакше остання точка жесту так і не дійшла б
function throttledPublisher<T>(intervalMs: () => number, build: (value: T) => Uint8Array) {
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
      // найсвіжіше значення кладемо завжди — навіть якщо зараз не шлемо,
      // його забере той, хто пошле наступним
      pending = value;
      const wait = intervalMs() - (Date.now() - lastSentAt);
      if (wait <= 0) {
        // інтервал уже вийшов — шлемо прямо тут, у тій самій задачі, що й
        // подія. Таймер, який мав би це зробити, на завантаженому потоці
        // запізнюється в рази: під час тягання кадр у 14мс приходив аж через
        // 75, і кожен другий виклик відсіювався перевіркою «таймер висить» —
        // курсор виходив удвічі рідший за оновлення самого обʼєкта
        window.clearTimeout(timer);
        timer = undefined;
        flush();
        return;
      }
      if (timer === undefined) timer = window.setTimeout(flush, wait);
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

const cursorPublisher = throttledPublisher<{ x: number; y: number }>(
  () => (useEditorStore.getState().interacting ? CURSOR_DRAG_THROTTLE_MS : CURSOR_THROTTLE_MS),
  (point) => {
    // [тип][x:f32][y:f32] — id відправника допише сервер
    const frame = new Uint8Array(1 + CURSOR_BYTES - SYNC_REQUESTER_ID_BYTES);
    frame[0] = SYNC_MSG.CURSOR;
    const view = new DataView(frame.buffer);
    view.setFloat32(1, point.x);
    view.setFloat32(5, point.y);
    return frame;
  },
);

const viewportPublisher = throttledPublisher<ViewportMessage>(
  () => VIEWPORT_THROTTLE_MS,
  (rect) => jsonFrame(SYNC_MSG.VIEWPORT, rect),
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

// чат кадрів не тротлить і нічого не тримає: людина шле повідомлення руками,
// частіше за раз на секунду це не буває. Автора й час призначає сервер —
// звідси й прилетить готове повідомлення, разом із копією для самого автора
export function publishChat(text: string) {
  if (!sendFrame) return;
  sendFrame(jsonFrame(SYNC_MSG.CHAT, { text }));
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
