import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface Props {
  // підпис лише для title/aria — на панелі місця під текст нема, тому іконка
  label: string;
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

// поле для натуральних чисел у межах [min, max]: поки друкуєш — приймає що
// завгодно (інакше не стерти "1", щоб набрати "15"), коректне значення в межах
// застосовується одразу (так працюють і стрілочки), а решта — на blur/Enter
// приводиться до числа й затискається в межі
export function NumberField({ label, icon, value, min, max, onCommit }: Props) {
  const [draft, setDraft] = useState(String(value));
  // значення змінилось ззовні (інший обʼєкт, resize) — підхоплюємо прямо в
  // рендері, як радить react, а не через effect
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setDraft(String(value));
  }

  function handleChange(raw: string) {
    setDraft(raw);
    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      if (n >= min && n <= max && n !== value) onCommit(n);
    }
  }

  function commit() {
    const parsed = Math.round(Number(draft));
    // порожнє або не число — повертаємо як було, а не 0
    const next =
      draft.trim() !== '' && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  return (
    <label className="ctx-number" title={label}>
      {icon}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </label>
  );
}
