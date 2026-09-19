import { useEffect, useRef, useState } from 'react';
import { fetchBoardSnapshot, saveBoardSnapshot } from '../api/boards';
import { asAppEdit, useBoardStore } from './board-store';
import { useEditorStore } from './editor-store';

// 2.5с від останньої зміни — під час тягання стор оновлюється на кожен рух,
// слати кожен кадр на сервер нема сенсу
const SAVE_DEBOUNCE_MS = 2500;

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error' | 'readonly';

// завантажує снепшот у board-store і зберігає його назад із дебаунсом.
// Стор про це не знає — працюємо з ним ззовні через add/getAll/removeMany,
// щоб персистентність не проросла в нього (наступного тижня тут буде Yjs)
//
// syncReady — право писати снепшот. Знімок іде в базу цілим, тому клієнт із
// неповним документом затирає там усе, чого сам не бачить. Поки не прийшла
// відповідь на sync-запит, документ саме такий — і краще не зберегти нічого,
// ніж стерти чуже (журнал 18.09)
export function useBoardPersistence(boardId: string | null, canWrite: boolean, syncReady: boolean) {
  const [status, setStatus] = useState<SaveStatus>('loading');
  // дошка, по якій рукостискання вже пройшло. Назад право не забираємо: після
  // відповіді документ цілий, і обрив звʼязку його не псує — інакше все,
  // намальоване після обриву, не збереглось би взагалі. Через ref, щоб поява
  // дозволу не перезапускала ефект: він перечитує снепшот
  const syncedBoardRef = useRef<string | null>(null);
  // чим ефект відкриває збереження, коли дозвіл нарешті прийшов
  const resumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!syncReady || !boardId) return;
    syncedBoardRef.current = boardId;
    resumeRef.current?.();
  }, [syncReady, boardId]);

  useEffect(() => {
    if (!boardId) return;
    const store = useBoardStore.getState();
    // стор глобальний — після іншої дошки в ньому лишились би її обʼєкти.
    // asAppEdit скрізь тут — це не правки людини, і ctrl+z не має ні зносити
    // щойно завантажену дошку, ні воскрешати чужу
    asAppEdit(() => store.removeMany(store.getAll().map((o) => o.id)));

    let loaded = false;
    let cancelled = false;
    // є зміни, яких сервер ще не бачив
    let pending = false;
    let timer: number | undefined;

    function idleStatus() {
      if (!canWrite) return 'readonly' as const;
      // ще не маємо права писати — це не «збережено», це «поки нікуди не пишу»
      return syncedBoardRef.current === boardId ? ('saved' as const) : ('loading' as const);
    }

    async function save(keepalive = false) {
      timer = undefined;
      if (!loaded || !canWrite || !boardId || syncedBoardRef.current !== boardId) return;
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

    // дозвіл писати зʼявився вже після завантаження — віддаємо те, що встигли
    // намалювати, поки чекали
    resumeRef.current = () => {
      if (!loaded) return;
      if (pending) schedule();
      else setStatus(idleStatus());
    };

    fetchBoardSnapshot(boardId)
      .then(({ objects }) => {
        if (cancelled) return;
        asAppEdit(() => {
          for (const object of objects) useBoardStore.getState().add(object);
        });
        loaded = true;
        setStatus(idleStatus());
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
      resumeRef.current = null;
      window.clearTimeout(timer);
      unsubObjects();
      unsubInteracting();
      window.removeEventListener('beforeunload', flush);
      const current = useBoardStore.getState();
      asAppEdit(() => current.removeMany(current.getAll().map((o) => o.id)));
      useEditorStore.getState().clearSelection();
    };
  }, [boardId, canWrite]);

  return status;
}
