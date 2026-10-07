import * as Y from 'yjs';
import { cellOfObject } from 'shared';
import type { BoardObject } from 'shared';
import { timed } from './aoi-perf';

// стратегія 3 (журнал 27.09): вміст дошки — не один Y.Doc, а по документу на
// клітинку сітки (shared/cells). У кожного документа своя історія й свій
// clientID, і клієнт тримає лише документи клітинок, на які передплачений.
// Решта застосунку бачить одну пласку мапу обʼєктів — дзеркало, яке цей клас
// збирає з усіх відкритих документів

// позначки походження: чуже з мережі назад не шлемо; засів зі снепшоту —
// шлемо, як і власні правки (інакше в кімнаті клітинки лишилась би дірка)
export const CELL_REMOTE = { source: 'cell-network' };
export const CELL_SEED = { source: 'cell-seed' };

// моє — усе, що не прийшло з мережі й не засіялось зі снепшоту. undo сюди теж
// потрапляє, і це правильно: скасування створення — така сама моя дія
const isLocal = (origin: unknown) => origin !== CELL_REMOTE && origin !== CELL_SEED;

interface Cell {
  doc: Y.Doc;
  map: Y.Map<BoardObject>;
  // історія клітинки вже в мене: або відповідь редактора, або засів зі снепшоту
  ready: boolean;
  // є власні правки, яких сервер ще не зберіг
  dirty: boolean;
}

interface Hooks {
  // змінились ці ключі дзеркала; undefined — обʼєкта більше нема.
  // local — чи це МОЯ правка. Згортання клітинки (close/reset) і засів зі
  // снепшоту теж прибирають обʼєкти з дзеркала, але видаленням не є: на
  // цьому прапорці тримається резерв місця під файли (file-holds)
  onMirror: (changes: Map<string, BoardObject | undefined>, local: boolean) => void;
  // власна правка в документі клітинки — її треба розіслати кімнаті клітинки
  onLocalUpdate: (cell: string, update: Uint8Array) => void;
  // запис у клітинку, якої ще нема серед відкритих (обʼєкт переїхав чи
  // створений далеко) — синхронізація має передплатитись ДО самого запису
  onNeedCell: (cell: string) => void;
  // документ клітинки зʼявився/зник — сюди чіпляється undo (cell-undo).
  // необовʼязкові: перевіркам самого протоколу історія правок ні до чого
  onOpenCell?: (cell: string, map: Y.Map<BoardObject>) => void;
  onCloseCell?: (cell: string) => void;
}

type Patch = Partial<BoardObject>;

export class CellDocs {
  private cells = new Map<string, Cell>();
  // глядач у документ не пише (як і на цілій дошці, журнал 27.09): що прочитав
  // зі снепшоту, тримаємо тут і показуємо, доки в документі нема історії
  private seeds = new Map<string, Map<string, BoardObject>>();

  constructor(private hooks: Hooks) {}

  isOpen(cell: string) {
    return this.cells.has(cell);
  }

  isReady(cell: string) {
    return this.cells.get(cell)?.ready ?? false;
  }

  openCells() {
    return [...this.cells.keys()];
  }

  readyCells() {
    return [...this.cells].filter(([, c]) => c.ready).map(([k]) => k);
  }

  dirtyCells() {
    return [...this.cells].filter(([, c]) => c.dirty).map(([k]) => k);
  }

  // свіжий порожній документ — завжди з нуля, без старої історії: на
  // клітинку, куди повертаємось, прийде повний стан, а не дельта до того, що
  // могло застаріти, поки нас там не було
  open(cell: string) {
    if (this.cells.has(cell)) return;
    const doc = new Y.Doc();
    const map = doc.getMap<BoardObject>('objects');
    const entry: Cell = { doc, map, ready: false, dirty: false };
    this.cells.set(cell, entry);
    // undo чіпляємо до першого запису: write() одразу за open() вже пише
    this.hooks.onOpenCell?.(cell, map);
    map.observe((event) => this.remirror(event.keysChanged, isLocal(event.transaction.origin)));
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === CELL_REMOTE) return;
      entry.dirty = true;
      this.hooks.onLocalUpdate(cell, update);
    });
  }

  close(cell: string) {
    const entry = this.cells.get(cell);
    if (!entry) return;
    const keys = new Set([...entry.map.keys(), ...(this.seeds.get(cell)?.keys() ?? [])]);
    // перед destroy: менеджер undo ще має відчепитись від живого документа
    this.hooks.onCloseCell?.(cell);
    entry.doc.destroy();
    this.cells.delete(cell);
    this.seeds.delete(cell);
    this.remirror(keys);
  }

  // глядачу прийшов CELL_RESET: документ з записами тих, хто пішов, кидаємо,
  // але на екрані лишається прочитане зі снепшоту, поки не прийде нова історія
  reset(cell: string) {
    const seed = this.seeds.get(cell);
    this.close(cell);
    this.open(cell);
    if (seed) {
      this.seeds.set(cell, seed);
      this.remirror(new Set(seed.keys()));
    }
  }

  closeAll() {
    for (const cell of [...this.cells.keys()]) this.close(cell);
  }

  setReady(cell: string) {
    const entry = this.cells.get(cell);
    if (entry) entry.ready = true;
  }

  clearDirty(cells: string[]) {
    for (const cell of cells) {
      const entry = this.cells.get(cell);
      if (entry) entry.dirty = false;
    }
  }

  hasHistory(cell: string) {
    return (this.cells.get(cell)?.doc.store.clients.size ?? 0) > 0;
  }

  stateVector(cell: string) {
    const entry = this.cells.get(cell);
    return entry ? Y.encodeStateVector(entry.doc) : new Uint8Array([0]);
  }

  encodeState(cell: string, stateVector?: Uint8Array) {
    const entry = this.cells.get(cell);
    return entry ? Y.encodeStateAsUpdate(entry.doc, stateVector) : new Uint8Array(0);
  }

  applyRemote(cell: string, update: Uint8Array) {
    const entry = this.cells.get(cell);
    if (!entry) return;
    const hadHistory = this.hasHistory(cell);
    timed('apply', () => Y.applyUpdate(entry.doc, update, CELL_REMOTE));
    // перша історія — правда тепер у документі; прочитане глядачем зі
    // снепшоту більше не показуємо (там міг лишитись уже видалений обʼєкт)
    const seed = this.seeds.get(cell);
    if (!hadHistory && seed && this.hasHistory(cell)) {
      this.seeds.delete(cell);
      this.remirror(seed.keys());
    }
  }

  // відповісти в клітинці не було кому — правда для неї у снепшоті. Редактор
  // кладе в документ лише те, чого там ще нема (власні свіжі записи новіші за
  // снепшот), глядач — лише в дзеркало
  seedFromSnapshot(cell: string, objects: BoardObject[], asEditor: boolean) {
    const mine = objects.filter((o) => cellOfObject(o) === cell);
    const entry = this.cells.get(cell);
    if (!entry) return;
    if (asEditor) {
      entry.doc.transact(() => {
        for (const o of mine) if (!entry.map.has(o.id)) entry.map.set(o.id, o);
      }, CELL_SEED);
      return;
    }
    this.seeds.set(cell, new Map(mine.map((o) => [o.id, o])));
    this.remirror(new Set(mine.map((o) => o.id)));
  }

  // глядача підняли до редактора: прочитане в дзеркало стає записами тих
  // клітинок, де історії нема (редакторів там не було)
  materializeSeeds() {
    for (const [cell, seed] of this.seeds) {
      if (this.hasHistory(cell)) continue;
      this.seedFromSnapshot(cell, [...seed.values()], true);
    }
    this.seeds.clear();
  }

  objectsOf(cells: string[]) {
    const out: BoardObject[] = [];
    for (const cell of cells) {
      const entry = this.cells.get(cell);
      if (entry) for (const o of entry.map.values()) out.push(o);
    }
    return out;
  }

  // ---- запис (усе, що в board-store пише в документ, у стратегії 3 іде сюди)

  add(object: BoardObject) {
    this.write(new Map([[object.id, { set: object }]]));
  }

  // патчі одного кадру: кожна клітинка — одна транзакція, отже один пакет
  applyPatches(patches: Map<string, Patch>) {
    const ops = new Map<string, { set?: BoardObject; from?: string }>();
    for (const [id, patch] of patches) {
      const found = this.find(id);
      if (!found) continue;
      ops.set(id, { set: { ...found.value, ...patch } as BoardObject, from: found.cell });
    }
    this.write(ops);
  }

  remove(ids: string[]) {
    const byCell = new Map<string, string[]>();
    for (const id of ids) {
      const found = this.find(id);
      if (!found) continue;
      byCell.set(found.cell, [...(byCell.get(found.cell) ?? []), id]);
    }
    for (const [cell, list] of byCell) {
      const entry = this.cells.get(cell)!;
      entry.doc.transact(() => {
        for (const id of list) entry.map.delete(id);
      });
    }
  }

  // спершу всі записи в нові клітинки, потім видалення зі старих: у того, хто
  // бачить обидві, обʼєкт на мить є двічі (дзеркало вибирає одну копію), але
  // ніколи не зникає
  private write(ops: Map<string, { set?: BoardObject; from?: string }>) {
    const sets = new Map<string, BoardObject[]>();
    const deletes = new Map<string, string[]>();
    for (const [id, op] of ops) {
      if (!op.set) continue;
      const target = cellOfObject(op.set);
      sets.set(target, [...(sets.get(target) ?? []), op.set]);
      if (op.from && op.from !== target) deletes.set(op.from, [...(deletes.get(op.from) ?? []), id]);
    }
    for (const [cell, objects] of sets) {
      if (!this.cells.has(cell)) {
        this.open(cell);
        this.hooks.onNeedCell(cell);
      }
      const entry = this.cells.get(cell)!;
      entry.doc.transact(() => {
        for (const o of objects) entry.map.set(o.id, o);
      });
    }
    for (const [cell, list] of deletes) {
      const entry = this.cells.get(cell);
      if (!entry) continue;
      entry.doc.transact(() => {
        for (const id of list) entry.map.delete(id);
      });
    }
  }

  // де лежить обʼєкт. Якщо в двох клітинках (посеред переїзду) — та копія,
  // чий центр справді в її клітинці
  private find(id: string): { cell: string; value: BoardObject } | null {
    let fallback: { cell: string; value: BoardObject } | null = null;
    for (const [cell, entry] of this.cells) {
      const value = entry.map.get(id);
      if (!value) continue;
      if (cellOfObject(value) === cell) return { cell, value };
      fallback ??= { cell, value };
    }
    return fallback;
  }

  private resolve(id: string): BoardObject | undefined {
    const found = this.find(id);
    if (found) return found.value;
    for (const [cell, seed] of this.seeds) {
      if (this.hasHistory(cell)) continue;
      const value = seed.get(id);
      if (value) return value;
    }
    return undefined;
  }

  private remirror(keys: Iterable<string>, local = false) {
    const changes = new Map<string, BoardObject | undefined>();
    for (const key of keys) changes.set(key, this.resolve(key));
    if (changes.size > 0) this.hooks.onMirror(changes, local);
  }
}
