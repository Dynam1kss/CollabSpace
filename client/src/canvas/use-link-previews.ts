import { useEffect } from 'react';
import { linkNeedsPreview } from 'shared';
import type { LinkObject } from 'shared';
import { useBoardStore } from './board-store';
import { loadLinkPreview } from './link-preview';

// скільки запитів тримаємо в повітрі одночасно. Більше й не треба: прев'ю —
// річ фонова, а сервер за кожним ходить у зовнішню мережу
const PARALLEL = 2;
// дошку щойно відкрили — хай спершу намалюється, а вже потім фонові запити
const START_DELAY_MS = 800;

// прев'ю збирається САМО, щойно дошка відкрита: кнопок для цього більше немає.
// Тягне лише редактор — у глядача ця ручка й так заборонена, він бачить те,
// що вже збережене в обʼєкті
export function useLinkPreviews(boardId: string | null, canEdit: boolean) {
  useEffect(() => {
    if (!boardId || !canEdit) return;
    let stopped = false;
    // у цьому сеансі вже бралися — другий раз не ходимо навіть якщо сервер
    // нічого не повернув
    const tried = new Set<string>();

    async function worker() {
      while (!stopped) {
        const next = pick(tried);
        if (!next) return;
        tried.add(next.id);
        await loadLinkPreview(boardId as string, next.id);
      }
    }

    const timer = window.setTimeout(() => {
      for (let i = 0; i < PARALLEL; i++) void worker();
    }, START_DELAY_MS);

    // нові картки зʼявляються й під час роботи — чужі теж; черга прокидається
    // на будь-яку зміну вмісту
    const unsub = useBoardStore.subscribe((state, prev) => {
      if (state.objects === prev.objects && !stopped) return;
      for (let i = 0; i < PARALLEL; i++) void worker();
    });

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      unsub();
    };
  }, [boardId, canEdit]);
}

function pick(tried: Set<string>): LinkObject | null {
  const now = Date.now();
  for (const object of Object.values(useBoardStore.getState().objects)) {
    if (object.type !== 'link' || tried.has(object.id)) continue;
    if (linkNeedsPreview(object, now)) return object;
  }
  return null;
}
