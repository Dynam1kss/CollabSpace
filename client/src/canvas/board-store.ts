import * as Y from 'yjs';
import { create } from 'zustand';
import { diag } from './diag';
import type {
  BoardObject,
  ConnectorObject,
  ImageObject,
  ShapeObject,
  StickyObject,
  TextObject,
} from 'shared';

// патч без id/type — не можна підмінити, чим є обʼєкт, лише його властивості
type BoardObjectPatch =
  | Partial<Omit<StickyObject, 'id' | 'type'>>
  | Partial<Omit<TextObject, 'id' | 'type'>>
  | Partial<Omit<ShapeObject, 'id' | 'type'>>
  | Partial<Omit<ConnectorObject, 'id' | 'type'>>
  | Partial<Omit<ImageObject, 'id' | 'type'>>;

interface BoardObjectsState {
  // дзеркало Y.Map нижче, лише для читання: React підписується на нього як на
  // звичайний zustand-стан; пишуть усі тільки через методи, а ті — в Y.Map
  objects: Record<string, BoardObject>;
  add: (object: BoardObject) => void;
  update: (id: string, patch: BoardObjectPatch) => void;
  // те саме, але з відкладеним записом — див. коментар біля черги нижче
  updateSoon: (id: string, patch: BoardObjectPatch) => void;
  flushUpdates: () => void;
  remove: (id: string) => void;
  removeMany: (ids: string[]) => void;
  getAll: () => BoardObject[];
  getById: (id: string) => BoardObject | undefined;
}

// джерело правди — CRDT-документ, який useBoardSync ганяє між клієнтами.
// ключ — id обʼєкта, значення — цілий обʼєкт. документ — один на відкриту
// дошку: resetBoardDoc нижче дає свіжий, бо історія й clientID попередньої
// дошки не мають потрапити в кімнату іншої (yjs тримає клоки без пропусків
// на кожного клієнта, чужа історія ламала б це)
export let boardDoc = new Y.Doc();
let yObjects = boardDoc.getMap<BoardObject>('objects');

// посеред жесту стор пишеться щокадру, і для групи це виходить N² записів:
// konva прокидає drag трансформера на всі виділені вузли, а обробник кожного
// ще й рухає решту. кожен запис окремо — це окрема транзакція й окремий пакет
// у мережу; приймач не встигає їх розбирати, черга в сокеті росте, і серверний
// ping застрягає за нею — два пропущені pong, і сервер рве сокет живому
// клієнту (журнал 20.09). Тому правки жесту складаємо тут і кладемо однією
// транзакцією раз на кадр: один пакет незалежно від розміру виділення
let queued: Map<string, BoardObjectPatch> | null = null;
let frameQueued = false;
// у vitest rAF немає — там мікротаска, аби не падало
const nextFrame: (fn: () => void) => void =
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame : queueMicrotask;

// правки, які робить не людина, а сам застосунок: завантаження снепшота й
// чистка стору при зміні дошки. Свій origin, щоб undo їх не бачив — інакше
// перший же ctrl+z після відкриття дошки зніс би її цілком
const APP_ORIGIN = { source: 'app' };

export function asAppEdit(fn: () => void) {
  boardDoc.transact(fn, APP_ORIGIN);
}

// хто спорожнив мапу востаннє. Потрібне запобіжнику в персистентності:
// «людина стерла все сама» і «щось усередині застосунку прибрало обʼєкти» —
// це різні події, і зберігати порожнечу можна лише в першому випадку
let emptiedBy: 'user' | 'app' | 'remote' | null = null;

export function lastEmptiedBy() {
  return emptiedBy;
}

// 500мс — те саме групування, що yjs бере за замовчуванням: серія дій в один
// такт (вставка кількох копій, видалення групи) лягає одним кроком. На жести
// це число не впливає взагалі, там час вимкнено — див. beginUndoGesture
const DISCRETE_CAPTURE_MS = 500;

// відкочуємо лише свої правки: trackedOrigins — це null, тобто транзакції без
// позначки. REMOTE_ORIGIN (чуже з мережі, useBoardSync) і APP_ORIGIN повз
// нього, бо ctrl+z не має відкочувати сусідові його ж роботу
// чи є що скасовувати/повторювати — для кнопок у панелі. Окремий крихітний
// стор, бо сам UndoManager не реактивний: він лише шле події про свій стек
export const useUndoState = create<{ canUndo: boolean; canRedo: boolean }>(() => ({
  canUndo: false,
  canRedo: false,
}));

function refreshUndoState() {
  useUndoState.setState({
    canUndo: boardUndo.undoStack.length > 0,
    canRedo: boardUndo.redoStack.length > 0,
  });
}

function createUndo() {
  const undo = new Y.UndoManager(yObjects, {
    trackedOrigins: new Set([null]),
    captureTimeout: DISCRETE_CAPTURE_MS,
  });
  undo.on('stack-item-added', refreshUndoState);
  undo.on('stack-item-popped', refreshUndoState);
  undo.on('stack-cleared', refreshUndoState);
  return undo;
}

export let boardUndo = createUndo();

// межі кроку undo для жесту. Тягання й трансформація пишуть у документ раз на
// кадр — за секунду це під 60 транзакцій, і без групування ctrl+z відкочував би
// жест покадрово. Всередині жесту час не ділить кроки взагалі: пауза посеред
// тягання (рука спинилась прицілитись) не має різати його надвоє
export function beginUndoGesture() {
  boardUndo.stopCapturing();
  boardUndo.captureTimeout = Number.MAX_SAFE_INTEGER;
}

// dragend у фігур спершу шле цей сигнал і лише потім дописує останній кадр
// (onDragEnd → commitPosition → flushUpdates), тому закриваємо крок не тут, а
// мікротаскою пізніше — інакше хвіст жесту став би окремим ctrl+z
export function endUndoGesture() {
  queueMicrotask(() => {
    boardUndo.captureTimeout = DISCRETE_CAPTURE_MS;
    boardUndo.stopCapturing();
  });
}

export const useBoardStore = create<BoardObjectsState>((set, get) => ({
  objects: {},

  add: (object) => yObjects.set(object.id, object),

  // злиття цілого обʼєкта: у Y.Map лягає новий обʼєкт, а не окремі поля —
  // одночасна правка одного обʼєкта двома людьми зведеться до «останній виграв»
  update: (id, patch) => {
    const existing = yObjects.get(id);
    if (!existing) return;
    yObjects.set(id, { ...existing, ...patch } as BoardObject);
  },

  updateSoon: (id, patch) => {
    queued ??= new Map();
    queued.set(id, { ...queued.get(id), ...patch } as BoardObjectPatch);
    if (frameQueued) return;
    frameQueued = true;
    nextFrame(() => {
      frameQueued = false;
      get().flushUpdates();
    });
  },

  // жест скінчився — дописуємо залишок одразу, не чекаючи кадру: далі
  // SelectionOverlay перечіпляє трансформер і має бачити вже кінцеві розміри
  flushUpdates: () => {
    const batch = queued;
    queued = null;
    if (!batch) return;
    boardDoc.transact(() => {
      for (const [id, patch] of batch) get().update(id, patch);
    });
  },

  remove: (id) => yObjects.delete(id),

  // одна транзакція — один observe і одне оновлення для мережі, а не N
  removeMany: (ids) =>
    boardDoc.transact(() => {
      for (const id of ids) yObjects.delete(id);
    }),

  getAll: () => Object.values(get().objects),
  getById: (id) => get().objects[id],
}));

// будь-яка зміна мапи (своя чи чужа з мережі) → перезбираємо дзеркало лише
// по зачеплених ключах; нове посилання objects — React перемальовує як і раніше
function mirror(event: Y.YMapEvent<BoardObject>) {
  if (yObjects.size === 0) {
    const origin: unknown = event.transaction.origin;
    emptiedBy = origin === APP_ORIGIN ? 'app' : origin == null ? 'user' : 'remote';
    diag('мапа обʼєктів спорожніла', { emptiedBy, keysChanged: event.keysChanged.size });
  } else {
    emptiedBy = null;
  }
  useBoardStore.setState((state) => {
    const objects = { ...state.objects };
    for (const key of event.keysChanged) {
      const value = yObjects.get(key);
      if (value === undefined) delete objects[key];
      else objects[key] = value;
    }
    return { objects };
  });
}
yObjects.observe(mirror);

// відкат до версії: документ стає рівно таким, як у переданому списку, однією
// транзакцією під позначкою застосунку (ctrl+z її не бачить). Ключ, значення
// якого не змінилось, не переписуємо — кожен зайвий set у y.map це ще один
// запис, що конкурує з чужими
export function replaceBoardContent(objects: BoardObject[]) {
  const next = new Map(objects.map((o) => [o.id, o]));
  asAppEdit(() => {
    for (const id of [...yObjects.keys()]) if (!next.has(id)) yObjects.delete(id);
    for (const object of objects) {
      const current = yObjects.get(object.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(object)) yObjects.set(object.id, object);
    }
  });
}

// після відкату старі кроки undo вказують на вміст, якого вже нема: ctrl+z
// повернув би шматки стану до відкату поверх нового. Тож історію правок чистимо
export function clearUndoHistory() {
  boardUndo.clear();
}

export function resetBoardDoc() {
  diag('resetBoardDoc: новий порожній документ', { було: yObjects.size });
  // недописаний жест зі старої дошки в нову не переносимо
  queued = null;
  // історія правок теж прив'язана до документа: на новій дошці ctrl+z не має
  // діставати кроки з попередньої
  boardUndo.destroy();
  boardDoc.destroy();
  boardDoc = new Y.Doc();
  yObjects = boardDoc.getMap<BoardObject>('objects');
  yObjects.observe(mirror);
  boardUndo = createUndo();
  refreshUndoState();
  emptiedBy = null;
  useBoardStore.setState({ objects: {} });
  return boardDoc;
}
