import { isSyncStrategy } from 'shared';
import type { SyncStrategy } from 'shared';

// стратегії синхронізації для експериментів розділу 4 (журнал 27.09):
//  per-event — кожна правка жесту одразу окремою транзакцією й окремим пакетом
//             (так було до 20.09, «стратегія 1», широкомовна на кожну подію);
//  batched   — правки жесту складаються й ідуть однією транзакцією раз на кадр
//             («стратегія 2»). per-event на груповому тяганні заливав сокет, і
//             сервер рвав звʼязок сусідові (20.09);
//  aoi       — як batched, але вміст розбитий на клітинки з власними історіями,
//             і клієнт синхронізує лише ті, що біля його вікна («стратегія 3»,
//             cell-docs + aoi-sync)
// одна кодова база, перемикач лише тут — стенд вибирає, що міряти
//
// режим кімнати оголошує СЕРВЕР кадром STRATEGY, і браузер його просто бере.
// Раніше вибирав браузер (?sync= плюс localStorage), і це розʼїхало кімнату:
// у власника з прогонів стенду лишилось 'aoi', у другого пристрою — дефолтний
// 'batched', а канали вмісту в цих режимів різні, тож одне одного вони не
// чули взагалі (журнал 05.10). Тому нічого більше не запамʼятовуємо
export type { SyncStrategy };

const STALE_KEY = 'collabspace:sync-strategy';
const FALLBACK: SyncStrategy = 'batched';

// ?sync= лишився лише для стенду й ручної перевірки, і лише у збірці, де його
// ввімкнули явно. У звичайній збірці прапорця нема — і підмінити режим кімнати
// з адресного рядка не можна
function overrideAllowed() {
  return import.meta.env?.VITE_ALLOW_SYNC_OVERRIDE === '1';
}

// що взяти, поки сервер не сказав свого, і чи це явний примус із адреси
export function resolveSyncStrategy(
  search: string,
  env: string | undefined,
  allowOverride: boolean,
): { strategy: SyncStrategy; forced: boolean } {
  if (allowOverride) {
    const fromQuery = new URLSearchParams(search).get('sync');
    if (isSyncStrategy(fromQuery)) return { strategy: fromQuery, forced: true };
  }
  return { strategy: isSyncStrategy(env) ? env : FALLBACK, forced: false };
}

function readInitial() {
  if (typeof window === 'undefined') {
    return { strategy: FALLBACK, forced: false };
  }
  // прибираємо старий ключ: поки його читали, він був міною — прогін стенду
  // лишав у браузері 'aoi' назавжди, і людина про це не знала
  try {
    localStorage.removeItem(STALE_KEY);
  } catch {
    // приватне вікно — там його й так нема
  }
  return resolveSyncStrategy(window.location.search, import.meta.env?.VITE_SYNC_STRATEGY, overrideAllowed());
}

const initial = readInitial();
let current: SyncStrategy = initial.strategy;
let forced = initial.forced;

// режим кімнати ще не оголошений — ні документів, ні розкладання снепшоту:
// не знаючи режиму, можна покласти вміст не в той документ. Обіцянка одна на
// сторінку, а не на дошку: стратегія в сервера одна на всі кімнати
let announce!: () => void;
let waiting = true;
const announced = new Promise<void>((resolve) => {
  announce = resolve;
});

function release() {
  if (!waiting) return;
  waiting = false;
  announce();
}

// примус зі стенду знати нічого не треба — він уже все вирішив
if (forced) release();

export function syncStrategy() {
  return current;
}

// чекати, поки стане відомо, чим працює кімната
export function syncStrategyAnnounced() {
  return announced;
}

// прилетів кадр STRATEGY
export function adoptSyncStrategy(strategy: SyncStrategy) {
  if (!forced) current = strategy;
  release();
}

// сокет обірвався, так і не сказавши режиму: лишаємось на тому, що знали, —
// інакше дошка назавжди висіла б у «завантаженні» без мережі
export function syncStrategyUnavailable() {
  release();
}

// для тестів: стор читає стратегію на кожен виклик, не лише на старті
export function setSyncStrategy(strategy: SyncStrategy) {
  current = strategy;
  forced = false;
  release();
}
