import { useEffect, useState } from 'react';
import { fetchBoardSnapshot, saveBoardSnapshot } from '../api/boards';
import { useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';

// 2.5с від останньої зміни — під час тягання стор оновлюється на кожен рух,
// слати кожен кадр на сервер нема сенсу
const SAVE_DEBOUNCE_MS = 2500;

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error' | 'readonly';

// завантажує снепшот у board-store і зберігає його назад із дебаунсом.
// Стор про це не знає — працюємо з ним ззовні через add/getAll/removeMany,
// щоб персистентність не проросла в нього (наступного тижня тут буде Yjs)
export function useBoardPersistence(boardId: string | null, canWrite: boolean) {
  const [status, setStatus] = useState<SaveStatus>('loading');

  useEffect(() => {
    if (!boardId) return;
    const store = useBoardStore.getState();
    // стор глобальний — після іншої дошки в ньому лишились би її обʼєкти
    store.removeMany(store.getAll().map((o) => o.id));

    let loaded = false;
    let cancelled = false;
    // є зміни, яких сервер ще не бачив
    let pending = false;
    let timer: number | undefined;

    async function save(keepalive = false) {
      timer = undefined;
      if (!loaded || !canWrite || !boardId) return;
      pending = false;
      setStatus('saving');
      try {
        await saveBoardSnapshot(boardId, useBoardStore.getState().getAll(), keepalive);
        if (cancelled) return;
        // поки летів запит, могли ще щось поміняти — тоді ще раз
        if (pending) schedule();
        else setStatus('saved');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_DEBOUNCE_MS);
    }

    function onChanged() {
      if (!loaded) return;
      pending = true;
      // посеред жесту стор тримає проміжний стан — чекаємо transformend/dragend
      if (useEditorStore.getState().interacting) return;
      schedule();
    }

    // без дебаунсу — на закриття вкладки й розмонтування
    function flush() {
      if (timer !== undefined || pending) void save(true);
    }

    fetchBoardSnapshot(boardId)
      .then(({ objects }) => {
        if (cancelled) return;
        for (const object of objects) useBoardStore.getState().add(object);
        loaded = true;
        setStatus(canWrite ? 'saved' : 'readonly');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    const unsubObjects = useBoardStore.subscribe((state, prev) => {
      if (state.objects !== prev.objects) onChanged();
    });
    const unsubInteracting = useEditorStore.subscribe((state, prev) => {
      if (prev.interacting && !state.interacting && pending) schedule();
    });
    window.addEventListener('beforeunload', flush);

    return () => {
      flush();
      cancelled = true;
      window.clearTimeout(timer);
      unsubObjects();
      unsubInteracting();
      window.removeEventListener('beforeunload', flush);
      const current = useBoardStore.getState();
      current.removeMany(current.getAll().map((o) => o.id));
      useEditorStore.getState().clearSelection();
    };
  }, [boardId, canWrite]);

  return status;
}
