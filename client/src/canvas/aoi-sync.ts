import { cellsOfInterest, decodeCellKey, encodeCellKey, SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { BoardObject, CellRect, CellSubscribeMessage } from 'shared';
import type { CellDocs } from './cell-docs';

// передплата на клітинки для стратегії 3 (журнал 27.09). Кожна клітинка —
// окрема кімната з тим самим рукостисканням, що й ціла дошка:
//   передплатився → sync-запит зі своїм (порожнім) вектором → відповідь →
//   клітинка «готова»: лише тепер її можна зберігати й віддавати іншим
// причинна безпека: у клітинці, на яку не передплачений, клієнт не має
// жодного клоку — пропустити там нічого не може. А на кожну нову передплату
// документ свіжий, тож і зі «старої» історії дірки не взятись

// та сама причина повторів, що й на цілій дошці: відповідач міг обірватись
const SYNC_RETRY_MS = 3000;
// пан — це десятки кадрів на секунду, а передплата — рукостискання на
// клітинку. тож на вікно реагуємо, коли воно хоч трохи постояло
const VIEW_DEBOUNCE_MS = 150;

export interface AoiIo {
  send: (frame: Uint8Array) => void;
  canWrite: () => boolean;
  // свіжий снепшот: правда для клітинок, де відповісти не було кому
  fetchSnapshot: () => Promise<BoardObject[]>;
  // посеред жесту передплату не знімаємо — див. reconcile
  interacting: () => boolean;
  // зберегти клітинки, які от-от відпустимо: інакше правки, яких ще не
  // зберіг дебаунс, зникли б разом із документом
  saveCells: (cells: string[], objects: BoardObject[]) => Promise<void>;
  // true — усі передплачені клітинки готові (статус «наживо»)
  onStatus: (allReady: boolean) => void;
}

function cellFrame(type: number, cell: string, body?: Uint8Array) {
  const key = encodeCellKey(cell);
  const out = new Uint8Array(1 + key.length + (body?.length ?? 0));
  out[0] = type;
  out.set(key, 1);
  if (body) out.set(body, 1 + key.length);
  return out;
}

export class AoiSync {
  // на які клітинки сервер уже знає нашу передплату
  private subscribed = new Set<string>();
  // чекаємо відповіді на свій sync-запит
  private awaiting = new Set<string>();
  // чужі запити до клітинки, яка в мене ще не готова (засів зі снепшоту
  // ще летить) — відповімо, щойно буде що віддати
  private heldRequests = new Map<string, Uint8Array[]>();
  // власні правки клітинок, яких сервер ще не бачив (сокет не відкритий,
  // передплата не дійшла) — після передплати віддамо повний стан
  private missed = new Set<string>();
  private connected = false;
  private view: CellRect | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setInterval> | undefined;
  private snapshot: Promise<BoardObject[]> | null = null;
  private stopped = false;

  constructor(
    private docs: CellDocs,
    private io: AoiIo,
  ) {}

  start() {
    this.connected = true;
    // клітинки, куди встигли написати до відкриття сокета
    const early = this.docs.openCells().filter((c) => !this.subscribed.has(c));
    if (early.length > 0) this.subscribe(early, []);
    this.reconcile();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.viewTimer);
    clearInterval(this.retryTimer);
  }

  setView(rect: CellRect, immediate = false) {
    this.view = rect;
    clearTimeout(this.viewTimer);
    if (immediate) this.reconcile();
    else this.viewTimer = setTimeout(() => this.reconcile(), VIEW_DEBOUNCE_MS);
  }

  // жест скінчився — відкладене зняття передплати можна робити
  gestureEnded() {
    this.reconcile();
  }

  allReady() {
    return [...this.subscribed].every((c) => this.docs.isReady(c));
  }

  // документ написав у клітинку, якої ще не було серед відкритих
  needCell(cell: string) {
    if (!this.connected) return;
    this.subscribe([cell], []);
  }

  localUpdate(cell: string, update: Uint8Array) {
    if (!this.io.canWrite()) return;
    if (!this.connected || !this.subscribed.has(cell)) {
      this.missed.add(cell);
      return;
    }
    this.io.send(cellFrame(SYNC_MSG.CELL_UPDATE, cell, update));
  }

  reconcile() {
    if (!this.connected || this.stopped || !this.view) return;
    const wanted = new Set(cellsOfInterest(this.view));
    const add = [...wanted].filter((c) => !this.subscribed.has(c));
    // посеред жесту нічого не відпускаємо: обʼєкт, який тягнуть, міг
    // формально опинитись за межею запасу, і документ його клітинки має
    // дожити до dragend — інакше останні кадри жесту не було б куди писати
    const remove = this.io.interacting()
      ? []
      : [...this.subscribed].filter((c) => !wanted.has(c) && !this.awaiting.has(c));
    if (add.length === 0 && remove.length === 0) return;
    this.subscribe(add, remove);
  }

  private subscribe(add: string[], remove: string[]) {
    // відпускаємо: спершу зберегти незбережене — у базі клітинка лишиться
    // такою, якою я її бачив останньою, навіть якщо в кімнаті вже нікого
    const dirty = remove.filter((c) => this.docs.isReady(c) && this.docs.dirtyCells().includes(c));
    if (dirty.length > 0 && this.io.canWrite()) {
      void this.io.saveCells(dirty, this.docs.objectsOf(dirty)).catch(() => {});
    }
    if (add.length > 0) this.snapshot = this.io.fetchSnapshot();

    const body: CellSubscribeMessage = { add, remove };
    const json = new TextEncoder().encode(JSON.stringify(body));
    const frame = new Uint8Array(1 + json.length);
    frame[0] = SYNC_MSG.CELL_SUBSCRIBE;
    frame.set(json, 1);
    this.io.send(frame);

    for (const cell of remove) {
      this.subscribed.delete(cell);
      this.awaiting.delete(cell);
      this.heldRequests.delete(cell);
      this.missed.delete(cell);
      this.docs.close(cell);
    }
    for (const cell of add) {
      this.subscribed.add(cell);
      this.docs.open(cell);
      // писали сюди, поки сервер не знав про передплату — повний стан одним
      // кадром, як missedWhileConnecting на цілій дошці (журнал 18.09)
      if (this.missed.delete(cell) && this.io.canWrite()) {
        this.io.send(cellFrame(SYNC_MSG.CELL_UPDATE, cell, this.docs.encodeState(cell)));
      }
      this.awaiting.add(cell);
      this.askForHistory(cell);
    }
    this.ensureRetry();
    this.io.onStatus(this.allReady());
  }

  private askForHistory(cell: string) {
    this.io.send(cellFrame(SYNC_MSG.CELL_SYNC_REQUEST, cell, this.docs.stateVector(cell)));
  }

  private ensureRetry() {
    if (this.awaiting.size === 0) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
      return;
    }
    this.retryTimer ??= setInterval(() => {
      for (const cell of this.awaiting) this.askForHistory(cell);
    }, SYNC_RETRY_MS);
  }

  // кадр клітинки з мережі
  handle(data: Uint8Array) {
    switch (data[0]) {
      case SYNC_MSG.CELL_UPDATE: {
        const key = decodeCellKey(data, 1);
        if (key && this.subscribed.has(key.cell)) this.docs.applyRemote(key.cell, data.subarray(key.next));
        return;
      }
      case SYNC_MSG.CELL_SYNC_REPLY: {
        const key = decodeCellKey(data, 1);
        if (!key || !this.awaiting.has(key.cell)) return;
        this.awaiting.delete(key.cell);
        this.ensureRetry();
        const body = data.subarray(key.next);
        if (body.length > 0) {
          this.docs.applyRemote(key.cell, body);
          this.markReady(key.cell);
        } else {
          void this.seed(key.cell);
        }
        return;
      }
      case SYNC_MSG.CELL_SYNC_REQUEST: {
        if (!this.io.canWrite() || data.length < 1 + SYNC_REQUESTER_ID_BYTES) return;
        const key = decodeCellKey(data, 1 + SYNC_REQUESTER_ID_BYTES);
        if (!key || !this.subscribed.has(key.cell)) return;
        if (!this.docs.isReady(key.cell)) {
          this.heldRequests.set(key.cell, [...(this.heldRequests.get(key.cell) ?? []), data]);
          return;
        }
        this.reply(key.cell, data);
        return;
      }
      case SYNC_MSG.CELL_RESET: {
        const key = decodeCellKey(data, 1);
        if (!key || !this.subscribed.has(key.cell) || this.io.canWrite()) return;
        this.docs.reset(key.cell);
        this.awaiting.add(key.cell);
        this.askForHistory(key.cell);
        this.ensureRetry();
        this.io.onStatus(this.allReady());
        return;
      }
    }
  }

  // [24][id][len][cell][update від їхнього вектора]
  private reply(cell: string, request: Uint8Array) {
    const id = request.subarray(1, 1 + SYNC_REQUESTER_ID_BYTES);
    const key = decodeCellKey(request, 1 + SYNC_REQUESTER_ID_BYTES);
    if (!key) return;
    const update = this.docs.encodeState(cell, request.subarray(key.next));
    const keyBytes = encodeCellKey(cell);
    const out = new Uint8Array(1 + id.length + keyBytes.length + update.length);
    out[0] = SYNC_MSG.CELL_SYNC_REPLY;
    out.set(id, 1);
    out.set(keyBytes, 1 + id.length);
    out.set(update, 1 + id.length + keyBytes.length);
    this.io.send(out);
  }

  // відповісти не було кому — правда в снепшоті. Не вдалося його прочитати —
  // клітинка не готова, питаємо знову (зберігати її порожньою не можна)
  private async seed(cell: string) {
    try {
      const objects = await (this.snapshot ?? this.io.fetchSnapshot());
      if (!this.subscribed.has(cell)) return;
      this.docs.seedFromSnapshot(cell, objects, this.io.canWrite());
      this.markReady(cell);
    } catch {
      if (!this.subscribed.has(cell)) return;
      this.awaiting.add(cell);
      this.ensureRetry();
    }
  }

  private markReady(cell: string) {
    this.docs.setReady(cell);
    for (const request of this.heldRequests.get(cell) ?? []) this.reply(cell, request);
    this.heldRequests.delete(cell);
    this.io.onStatus(this.allReady());
  }
}

// видиме вікно приходить зі сторінки дошки, а синхронізація живе в хуку
// сокета — між ними одна точка. Останнє вікно памʼятаємо: сокет може
// відкритись пізніше, ніж полотно дізнається свій розмір
let attached: AoiSync | null = null;
let lastView: CellRect | null = null;

export function setAoiView(rect: CellRect) {
  lastView = rect;
  attached?.setView(rect);
}

export function attachAoi(sync: AoiSync | null) {
  attached = sync;
  if (sync && lastView) sync.setView(lastView, true);
}
