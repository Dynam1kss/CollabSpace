import * as Y from 'yjs';
import type { BoardObject } from 'shared';

// undo/redo у стратегії 3. Вміст там лежить не в одному документі, а по
// документу на клітинку, і один Y.UndoManager на кілька документів не вішається:
// він слухає afterTransaction рівно одного доку. Тому менеджер на клітинку, а
// порядок кроків людини тримаємо тут окремим стеком — ctrl+z бере останній крок,
// у якій би клітинці він не стався (журнал 05.10)
//
// крок людини може зачепити дві клітинки одразу: обʼєкт переїхав межу (запис у
// нову, видалення зі старої) або видалили виділення по обидва боки межі. Тому
// в стеку не просто клітинка, а ще й номер кроку — відкочуємо всі записи
// одного кроку разом, інакше одне натискання лишало б обʼєкт у двох копіях
interface Entry {
  cell: string;
  step: number;
}

export class CellUndo {
  private managers = new Map<string, Y.UndoManager>();
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  // поточне вікно групування: жест вимикає час (див. beginGesture), і клітинка,
  // відкрита вже посеред жесту, має підхопити те саме
  private captureMs: number;
  private step = 0;
  private stepQueued = false;
  // жест або власний відкат — усе всередині одним кроком
  private holdStep = false;
  // зворотні записи від мого ж undo/redo: вони не мають гасити «повторити»
  private applying = false;

  constructor(
    private discreteCaptureMs: number,
    private onChange: () => void,
  ) {
    this.captureMs = discreteCaptureMs;
  }

  track(cell: string, map: Y.Map<BoardObject>) {
    if (this.managers.has(cell)) return;
    // як і в головному документі: відкочуємо лише транзакції без позначки,
    // тобто свої. CELL_REMOTE (чуже з мережі) і CELL_SEED (засів зі снепшоту)
    // повз нього
    const manager = new Y.UndoManager(map, {
      trackedOrigins: new Set([null]),
      captureTimeout: this.captureMs,
    });
    manager.on('stack-item-added', (e: { type: 'undo' | 'redo' }) => {
      this.noteStep();
      (e.type === 'redo' ? this.redoStack : this.undoStack).push({ cell, step: this.step });
      if (!this.applying) this.dropRedo();
      this.onChange();
    });
    manager.on('stack-item-popped', () => this.onChange());
    this.managers.set(cell, manager);
  }

  forget(cell: string) {
    const manager = this.managers.get(cell);
    if (!manager) return;
    manager.destroy();
    this.managers.delete(cell);
    // клітинку відпустили (пан убік) — її кроки з історії випадають: документа,
    // куди вони писали, більше нема, а на нову передплату приходить свіжий
    this.undoStack = this.undoStack.filter((e) => e.cell !== cell);
    this.redoStack = this.redoStack.filter((e) => e.cell !== cell);
    this.onChange();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    this.apply(this.undoStack, 'undo');
  }

  redo() {
    this.apply(this.redoStack, 'redo');
  }

  clear() {
    for (const manager of this.managers.values()) manager.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }

  // межі кроку для жесту — те саме, що beginUndoGesture для цілої дошки:
  // тягання пише раз на кадр, і без цього ctrl+z відкочував би його покадрово
  beginGesture() {
    this.step++;
    this.holdStep = true;
    this.captureMs = Number.MAX_SAFE_INTEGER;
    for (const manager of this.managers.values()) {
      manager.stopCapturing();
      manager.captureTimeout = this.captureMs;
    }
  }

  endGesture() {
    this.holdStep = false;
    this.step++;
    this.captureMs = this.discreteCaptureMs;
    for (const manager of this.managers.values()) {
      manager.captureTimeout = this.captureMs;
      manager.stopCapturing();
    }
  }

  private apply(stack: Entry[], kind: 'undo' | 'redo') {
    const top = stack[stack.length - 1];
    if (!top) return;
    this.step++;
    this.holdStep = true;
    this.applying = true;
    while (stack.length > 0 && stack[stack.length - 1].step === top.step) {
      const entry = stack.pop()!;
      const manager = this.managers.get(entry.cell);
      if (kind === 'undo') manager?.undo();
      else manager?.redo();
    }
    this.applying = false;
    this.holdStep = false;
    this.step++;
    this.onChange();
  }

  // усе, що лягло в один такт, — один крок: видалення виділення з двох клітинок
  // іде двома транзакціями, але для людини це одне натискання Delete
  private noteStep() {
    if (this.holdStep || this.stepQueued) return;
    this.stepQueued = true;
    queueMicrotask(() => {
      this.stepQueued = false;
      this.step++;
    });
  }

  private dropRedo() {
    this.redoStack = [];
    for (const manager of this.managers.values()) manager.clear(false, true);
  }
}
