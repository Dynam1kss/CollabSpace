// кому показувати свій вид. Вибір особистий і суто для зручності — у
// документ і на сервер він не їде, тому живе в localStorage цього браузера.
// Перше місце в проєкті, де взагалі є localStorage: дошці це не вміст, а
// іншим учасникам воно ні до чого
export type ShowViewTargets = 'all' | string[];

// ключ із дошкою і людиною: на спільному компʼютері два акаунти не мають
// бачити чужий вибір, а на різних дошках склад учасників різний
export function showViewTargetsKey(boardId: string, userId: string) {
  return `collabspace:show-view-targets:${boardId}:${userId}`;
}

// будь-яке сміття (стара версія, зіпсований json, порожній список) читаємо
// як «усім» — це поведінка до появи вибору, і зіпсувати нею сеанс не можна
export function parseShowViewTargets(raw: string | null): ShowViewTargets {
  if (raw === null) return 'all';
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return 'all';
    const ids = value.filter((id): id is string => typeof id === 'string');
    return ids.length === 0 ? 'all' : ids;
  } catch {
    return 'all';
  }
}

export function serializeShowViewTargets(targets: ShowViewTargets) {
  return JSON.stringify(targets === 'all' ? [] : targets);
}

// приватне вікно чи вимкнене сховище кидають прямо на доступі до
// localStorage, не лише на записі — тому в try весь виклик
export function loadShowViewTargets(boardId: string, userId: string): ShowViewTargets {
  try {
    return parseShowViewTargets(localStorage.getItem(showViewTargetsKey(boardId, userId)));
  } catch {
    return 'all';
  }
}

export function saveShowViewTargets(boardId: string, userId: string, targets: ShowViewTargets) {
  try {
    localStorage.setItem(showViewTargetsKey(boardId, userId), serializeShowViewTargets(targets));
  } catch {
    // сховища нема — вибір просто не переживе перезавантаження
  }
}
