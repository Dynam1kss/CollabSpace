import * as Y from 'yjs';
import { create } from 'zustand';
import { diag } from './diag';
import { syncStrategy } from './sync-strategy';
import { CellDocs } from './cell-docs';
import { CellUndo } from './cell-undo';
import { markPaint, timed } from './aoi-perf';
import type {
  BoardObject,
  ConnectorObject,
  ImageObject,
  LineObject,
  LinkObject,
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
  | Partial<Omit<LineObject, 'id' | 'type'>>
  | Partial<Omit<ImageObject, 'id' | 'type'>>
  | Partial<Omit<LinkObject, 'id' | 'type'>>;

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

// стратегія 3: документи клітинок. стор про клітинки знає лише одне — куди
// писати; що передплачено й коли, вирішує синхронізація (aoi-sync), яка сюди
// чіпляється через setCellSyncHooks. цілий boardDoc у цьому режимі порожній,
// тож і undo по ньому нічого не бачить (журнал 27.09)
interface CellSyncHooks {
  localUpdate: (cell: string, update: Uint8Array) => void;
  needCell: (cell: string) => void;
}
let cellSyncHooks: CellSyncHooks | null = null;

export function setCellSyncHooks(hooks: CellSyncHooks | null) {
  cellSyncHooks = hooks;
}

// 500мс — те саме групування, що yjs бере за замовчуванням: серія дій в один
// такт (вставка кількох копій, видалення групи) лягає одним кроком. На жести
// це число не впливає взагалі, там час вимкнено — див. beginUndoGesture
const DISCRETE_CAPTURE_MS = 500;

// стратегія 3: історія правок теж по клітинках — один UndoManager на кілька
// документів не вішається (див. cell-undo)
export const cellUndo = new CellUndo(DISCRETE_CAPTURE_MS, () => refreshUndoState());

export const cellDocs = new CellDocs({
  onOpenCell: (cell, map) => cellUndo.track(cell, map),
  onCloseCell: (cell) => cellUndo.forget(cell),
  // зворотний бік тієї самої межі: поза стратегією 3 клітинки дзеркала не
  // торкаються. Сюди долітає хіба що closeAll зі скидання документа
  onMirror: (changes, local) => {
    if (!aoi()) return;
    noteRemovals(changes, local);
    timed('mirror', () =>
      useBoardStore.setState((state) => {
        const objects = { ...state.objects };
        for (const [id, value] of changes) {
          if (value) objects[id] = value;
          else delete objects[id];
        }
        return { objects };
      }),
    );
    markPaint();
  },
  onLocalUpdate: (cell, update) => cellSyncHooks?.localUpdate(cell, update),
  onNeedCell: (cell) => cellSyncHooks?.needCell(cell),
});

const aoi = () => syncStrategy() === 'aoi';

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

// чуже з мережі. Живе тут, а не в useBoardSync: локальність правки тепер
// питають і дзеркало, і резерви місця під файли
export const REMOTE_ORIGIN = { source: 'network' };

export function asAppEdit(fn: () => void) {
  boardDoc.transact(fn, APP_ORIGIN);
}

// id обʼєктів, які зникли через МОЮ правку. Резерв місця під файли має
// належати тому, хто видалив, а не кожному, хто побачив видалення: інакше
// місце тримає будь-хто, хто просто сидить на дошці (журнал 07.10).
// Накопичуємо до того, як підписник це забере, — за кадр правок може бути
// кілька, а підписка стріляє раз
let localRemovals = new Set<string>();

export function takeLocalRemovals() {
  if (localRemovals.size === 0) return localRemovals;
  const taken = localRemovals;
  localRemovals = new Set();
  return taken;
}

function noteRemovals(changes: Map<string, BoardObject | undefined>, local: boolean) {
  if (!local) return;
  for (const [id, value] of changes) if (value === undefined) localRemovals.add(id);
}

// хто спорожнив мапу востаннє. Потрібне запобіжнику в персистентності:
// «людина стерла все сама» і «щось усередині застосунку прибрало обʼєкти» —
// це різні події, і зберігати порожнечу можна лише в першому випадку
let emptiedBy: 'user' | 'app' | 'remote' | null = null;

export function lastEmptiedBy() {
  return emptiedBy;
}

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
  useUndoState.setState(
    aoi()
      ? { canUndo: cellUndo.canUndo, canRedo: cellUndo.canRedo }
      : { canUndo: boardUndo.undoStack.length > 0, canRedo: boardUndo.redoStack.length > 0 },
  );
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
  if (aoi()) {
    cellUndo.beginGesture();
    return;
  }
  boardUndo.stopCapturing();
  boardUndo.captureTimeout = Number.MAX_SAFE_INTEGER;
}

// dragend у фігур спершу шле цей сигнал і лише потім дописує останній кадр
// (onDragEnd → commitPosition → flushUpdates), тому закриваємо крок не тут, а
// мікротаскою пізніше — інакше хвіст жесту став би окремим ctrl+z
export function endUndoGesture() {
  queueMicrotask(() => {
    if (aoi()) {
      cellUndo.endGesture();
      return;
    }
    boardUndo.captureTimeout = DISCRETE_CAPTURE_MS;
    boardUndo.stopCapturing();
  });
}

// куди йдуть ctrl+z і ctrl+y — залежить від стратегії: у головний документ чи
// по клітинках. Вище цього board-undo вже не розбирає, яким режимом ми працюємо
export function performUndo() {
  if (aoi()) cellUndo.undo();
  else boardUndo.undo();
}

export function performRedo() {
  if (aoi()) cellUndo.redo();
  else boardUndo.redo();
}

export const useBoardStore = create<BoardObjectsState>((set, get) => ({
  objects: {},

  add: (object) => (aoi() ? cellDocs.add(object) : yObjects.set(object.id, object)),

  // злиття цілого обʼєкта: у Y.Map лягає новий обʼєкт, а не окремі поля —
  // одночасна правка одного обʼєкта двома людьми зведеться до «останній виграв»
  update: (id, patch) => {
    if (aoi()) {
      cellDocs.applyPatches(new Map([[id, patch as Partial<BoardObject>]]));
      return;
    }
    const existing = yObjects.get(id);
    if (!existing) return;
    yObjects.set(id, { ...existing, ...patch } as BoardObject);
  },

  updateSoon: (id, patch) => {
    // стратегія 1 для експерименту: без накопичення, кожна правка — своя
    // транзакція й свій пакет. локально вузол konva і так рухається щоподії
    if (syncStrategy() === 'per-event') {
      boardDoc.transact(() => get().update(id, patch));
      return;
    }
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
    // клітинки: по транзакції на кожну зачеплену — і так по пакету на клітинку за кадр
    if (aoi()) {
      cellDocs.applyPatches(batch as Map<string, Partial<BoardObject>>);
      return;
    }
    boardDoc.transact(() => {
      for (const [id, patch] of batch) get().update(id, patch);
    });
  },

  remove: (id) => (aoi() ? cellDocs.remove([id]) : yObjects.delete(id)),

  // одна транзакція — один observe і одне оновлення для мережі, а не N
  removeMany: (ids) =>
    aoi()
      ? cellDocs.remove(ids)
      : boardDoc.transact(() => {
          for (const id of ids) yObjects.delete(id);
        }),

  getAll: () => Object.values(get().objects),
  getById: (id) => get().objects[id],
}));

// будь-яка зміна мапи (своя чи чужа з мережі) → перезбираємо дзеркало лише
// по зачеплених ключах; нове посилання objects — React перемальовує як і раніше
function mirror(event: Y.YMapEvent<BoardObject>) {
  // у стратегії 3 правда про вміст — у клітинках, і головний документ до
  // дзеркала не має стосунку взагалі. Без цієї перевірки чужий UPDATE (клієнт
  // іншої стратегії, старий клієнт, помилка) переписував би дзеркало поверх
  // клітинок: обʼєкт отримував двох письменників, і прапорці на ньому
  // перемикались самі собою — звідси «дозволити стільці» через раз (05.10).
  // Сервер такого клієнта вже не пускає, це другий рубіж
  if (aoi()) return;
  const origin: unknown = event.transaction.origin;
  noteRemovals(
    new Map([...event.keysChanged].map((key) => [key, yObjects.get(key)])),
    origin !== REMOTE_ORIGIN && origin !== APP_ORIGIN,
  );
  if (yObjects.size === 0) {
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
  cellUndo.clear();
}

// глядач. Його записи в документ сервер нікуди не шле, тож власний запис того
// самого ключа, що й у редактора, у y.map стає конфліктом, який бачить лише він:
// за меншого clientID редактора лишається його варіант, і правки та видалення
// цього обʼєкта до глядача вже не доходять (журнал 27.09). Тому глядач у
// документ не пише ніколи: те, що він прочитав із rest, кладемо лише в
// дзеркало, а документ тримає тільки записи редакторів
export function seedMirror(objects: BoardObject[]) {
  useBoardStore.setState({ objects: Object.fromEntries(objects.map((o) => [o.id, o])) });
}

// документ отримав чужу історію — тепер правда в ньому, а не в тому, що глядач
// сам прочитав із rest (там міг лишитись уже видалений обʼєкт)
export function rebuildMirrorFromDoc() {
  useBoardStore.setState({ objects: yObjects.toJSON() as Record<string, BoardObject> });
}

// чи є в документі хоч якась історія. Редактор, що ще не встиг завантажити
// снепшот, відповідає порожнім документом — таку відповідь за правду не беремо
export function docHasHistory() {
  return boardDoc.store.clients.size > 0;
}

// глядача підняли до редактора: те, що він бачив лише в дзеркалі, має стати
// записами документа, інакше update() такого обʼєкта не знайде. Тепер його
// записи вже йдуть решті, тож це безпечно
export function materializeMirror() {
  const missing = Object.values(useBoardStore.getState().objects).filter((o) => !yObjects.has(o.id));
  if (missing.length === 0) return;
  asAppEdit(() => {
    for (const object of missing) yObjects.set(object.id, object);
  });
}

// keepMirror — глядач міняє документ посеред сеансу, а на екрані має лишитись
// те саме, поки не прийде історія нового редактора
export function resetBoardDoc(keepMirror = false) {
  diag('resetBoardDoc: новий порожній документ', { було: yObjects.size, keepMirror });
  // недописаний жест зі старої дошки в нову не переносимо
  queued = null;
  if (!keepMirror) cellDocs.closeAll();
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
  if (!keepMirror) useBoardStore.setState({ objects: {} });
  return boardDoc;
}
