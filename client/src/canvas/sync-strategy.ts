// стратегії синхронізації для експериментів розділу 4 (журнал 27.09):
//  per-event — кожна правка жесту одразу окремою транзакцією й окремим пакетом
//             (так було до 20.09, «стратегія 1», широкомовна на кожну подію);
//  batched   — правки жесту складаються й ідуть однією транзакцією раз на кадр
//             («стратегія 2»). за замовчуванням — вона: per-event на груповому
//             тяганні заливав сокет, і сервер рвав звʼязок сусідові (20.09).
// одна кодова база, перемикач лише тут — стенд вибирає, що міряти
export type SyncStrategy = 'per-event' | 'batched';

export const SYNC_STRATEGY_KEY = 'collabspace:sync-strategy';
const DEFAULT: SyncStrategy = 'batched';

function parse(value: string | null | undefined): SyncStrategy | null {
  return value === 'per-event' || value === 'batched' ? value : null;
}

// ?sync=... — найвищий пріоритет і запамʼятовується в localStorage, щоб стенд
// міг ходити між сторінками; далі localStorage, далі змінна збірки, далі дефолт
export function resolveSyncStrategy(
  search: string,
  stored: string | null,
  env: string | undefined,
): { strategy: SyncStrategy; persist: SyncStrategy | null } {
  const fromQuery = parse(new URLSearchParams(search).get('sync'));
  if (fromQuery) return { strategy: fromQuery, persist: fromQuery };
  return { strategy: parse(stored) ?? parse(env) ?? DEFAULT, persist: null };
}

function readInitial(): SyncStrategy {
  if (typeof window === 'undefined') return parse(import.meta.env?.VITE_SYNC_STRATEGY) ?? DEFAULT;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SYNC_STRATEGY_KEY);
  } catch {
    // приватне вікно — лишається query чи дефолт
  }
  const { strategy, persist } = resolveSyncStrategy(
    window.location.search,
    stored,
    import.meta.env?.VITE_SYNC_STRATEGY,
  );
  if (persist) {
    try {
      localStorage.setItem(SYNC_STRATEGY_KEY, persist);
    } catch {
      // див. вище
    }
  }
  return strategy;
}

let current: SyncStrategy = readInitial();

export function syncStrategy() {
  return current;
}

// для тестів: стор читає стратегію на кожен виклик, не лише на старті
export function setSyncStrategy(strategy: SyncStrategy) {
  current = strategy;
}
