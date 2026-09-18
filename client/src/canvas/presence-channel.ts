import { CURSOR_BYTES, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';

// присутність шле через той самий сокет, що й документ — useBoardSync ставить
// сюди свій send, коли відкриває зʼєднання, і знімає на розриві. Модульна
// змінна, а не проп: курсор народжується в BoardCanvas, а виділення — у
// підписці на editor-store, тягнути сокет через обидва шляхи пропсами дорожче
let sendFrame: ((data: Uint8Array) => void) | null = null;

export function setPresenceSender(fn: ((data: Uint8Array) => void) | null) {
  sendFrame = fn;
  if (!fn) {
    pending = null;
    window.clearTimeout(timer);
    timer = undefined;
  }
}

// ~18 кадрів на секунду. Курсор — не документ: втрачений кадр перекриється
// наступним, тому шлемо не на кожен mousemove, а по таймеру. Останнє
// положення доходить завжди — таймер із хвостом, а не простий «не частіше ніж»
export const CURSOR_THROTTLE_MS = 55;

let pending: { x: number; y: number } | null = null;
let lastSentAt = 0;
let timer: number | undefined;

function flushCursor() {
  timer = undefined;
  const point = pending;
  pending = null;
  if (!point || !sendFrame) return;
  lastSentAt = Date.now();

  // [тип][x:f32][y:f32] — id відправника допише сервер
  const frame = new Uint8Array(1 + CURSOR_BYTES - SYNC_REQUESTER_ID_BYTES);
  frame[0] = SYNC_MSG.CURSOR;
  const view = new DataView(frame.buffer);
  view.setFloat32(1, point.x);
  view.setFloat32(5, point.y);
  sendFrame(frame);
}

// виділення міняється рідко (клік, рамка, ctrl+a) — тут тротлінг ні до чого
export function publishSelection(selectedIds: string[]) {
  if (!sendFrame) return;
  const body = new TextEncoder().encode(JSON.stringify(selectedIds));
  const frame = new Uint8Array(1 + body.length);
  frame[0] = SYNC_MSG.SELECTION;
  frame.set(body, 1);
  sendFrame(frame);
}

export function publishCursor(point: { x: number; y: number }) {
  pending = point;
  if (timer !== undefined) return;
  timer = window.setTimeout(flushCursor, Math.max(0, CURSOR_THROTTLE_MS - (Date.now() - lastSentAt)));
}
