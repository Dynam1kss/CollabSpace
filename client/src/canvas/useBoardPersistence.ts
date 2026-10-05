import { useEffect, useRef, useState } from 'react';
import { fetchBoardSnapshot, saveBoardSnapshot } from '../api/boards';
import { asAppEdit, cellDocs, docHasHistory, lastEmptiedBy, seedMirror, useBoardStore } from './board-store';
import { syncStrategy, syncStrategyAnnounced } from './sync-strategy';
import { diag, diagAlarm } from './diag';
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
  // право писати — через ref, а НЕ в залежностях ефекту. Коли воно було в
  // залежностях, будь-яка зміна ролі перезапускала ефект: той чистив стор,
  // перечитував снепшот — і між цим документ стояв порожній, та ще й
  // розсилав видалення всім (журнал 20.09, втрата обʼєктів)
  const canWriteRef = useRef(canWrite);
  useEffect(() => {
    canWriteRef.current = canWrite;
  }, [canWrite]);
  // скільки обʼєктів ми востаннє бачили цілими: зі снепшота на вході й після
  // кожного вдалого збереження. Запобіжник нижче звіряється саме з цим
  const lastKnownCountRef = useRef(0);
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

  // роль тепер не перезапускає головний ефект, тому підпис статусу міняємо
  // окремо: знизили до глядача — одразу «лише перегляд», повернули — назад
  useEffect(() => {
    if (!boardId) return;
    setStatus(canWrite ? (syncedBoardRef.current === boardId ? 'saved' : 'loading') : 'readonly');
  }, [canWrite, boardId]);

  useEffect(() => {
    if (!boardId) return;
    // стор НЕ чистимо: видалення ключів у Y.Map — це не «прибрати в себе на
    // екрані», а повноцінна правка документа, яка летить усім і лягає в базу.
    // Свіжий порожній документ на кожну дошку дає resetBoardDoc у useBoardSync
    diag('персистентність: ефект стартував', { boardId, уСторі: useBoardStore.getState().getAll().length });

    let loaded = false;
    let cancelled = false;
    // є зміни, яких сервер ще не бачив
    let pending = false;
    let timer: number | undefined;

    function idleStatus() {
      if (!canWriteRef.current) return 'readonly' as const;
      // ще не маємо права писати — це не «збережено», це «поки нікуди не пишу»
      return syncedBoardRef.current === boardId ? ('saved' as const) : ('loading' as const);
    }

    async function save(keepalive = false) {
      timer = undefined;
      if (!loaded || !canWriteRef.current || !boardId || syncedBoardRef.current !== boardId) {
        diag('збереження пропущено', {
          boardId,
          loaded,
          canWrite: canWriteRef.current,
          syncReady: syncedBoardRef.current === boardId,
        });
        return;
      }

      // стратегія 3: у мене лише частина дошки. пишу рівно ті клітинки, чия
      // історія вже в мене, — сервер замінить у базі тільки їх. запобіжник від
      // порожнечі тут не потрібен: порожня готова клітинка — справжня правда
      if (syncStrategy() === 'aoi') {
        const cells = cellDocs.readyCells();
        if (cells.length === 0) return;
        pending = false;
        setStatus('saving');
        try {
          await saveBoardSnapshot(boardId, cellDocs.objectsOf(cells), keepalive, cells);
          cellDocs.clearDirty(cells);
          if (cancelled) return;
          if (pending) schedule();
          else setStatus('saved');
        } catch {
          if (!cancelled) setStatus('error');
        }
        return;
      }

      const objects = useBoardStore.getState().getAll();
      // запобіжник: порожній документ поверх непорожньої дошки — це майже
      // завжди наслідок чиєїсь помилки, а не намір. Пропускаємо саме такий
      // запис. Виняток — коли людина сама все стерла: тоді порожнеча законна
      if (objects.length === 0 && lastKnownCountRef.current > 0) {
        const cause = lastEmptiedBy();
        if (cause !== 'user') {
          diagAlarm('порожній знімок поверх непорожньої дошки — НЕ зберігаю', {
            boardId,
            було: lastKnownCountRef.current,
            стало: 0,
            хтоСпорожнив: cause,
          });
          pending = false;
          setStatus(idleStatus());
          return;
        }
        diagAlarm('зберігаю порожню дошку — але це зробила людина', {
          boardId,
          було: lastKnownCountRef.current,
        });
      }

      pending = false;
      setStatus('saving');
      diag('зберігаю знімок', { boardId, обʼєктів: objects.length, syncReady: true });
      try {
        await saveBoardSnapshot(boardId, objects, keepalive);
        lastKnownCountRef.current = objects.length;
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

    diag('снепшот: запит пішов', { boardId });
    // запит іде одразу, а розкладаємо його лише коли сервер оголосив режим
    // кімнати: у стратегії 3 знімок у головний документ класти не можна, а до
    // кадру STRATEGY ми не знаємо, чи вона (журнал 05.10)
    Promise.all([fetchBoardSnapshot(boardId), syncStrategyAnnounced()])
      .then(([{ objects }]) => {
        diag('снепшот: відповідь', { boardId, обʼєктів: objects.length, скасовано: cancelled });
        if (cancelled) return;
        // стратегія 3 знімок у стор не кладе: клітинки беруть свій вміст самі,
        // на передплаті (aoi-sync) — і лише ті, біля яких вікно
        const aoiMode = syncStrategy() === 'aoi';
        if (!aoiMode && canWriteRef.current) {
          // під позначкою застосунку: завантаження дошки — не правка людини,
          // і ctrl+z не має зносити щойно прочитаний знімок (журнал 20.09)
          asAppEdit(() => {
            for (const object of objects) useBoardStore.getState().add(object);
          });
        } else if (!aoiMode && !docHasHistory()) {
          // глядач — лише в дзеркало, у документ ні (див. seedMirror). Якщо
          // історія редактора вже прийшла, rest запізнився і правда вже є
          seedMirror(objects);
        }
        lastKnownCountRef.current = Math.max(lastKnownCountRef.current, objects.length);
        loaded = true;
        setStatus(idleStatus());
      })
      .catch((err) => {
        diagAlarm('снепшот не завантажився', { boardId, err: String(err) });
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
      diag('персистентність: ефект згортається', {
        boardId,
        уСторі: useBoardStore.getState().getAll().length,
      });
      // дописати те, що не встигло, — і більше нічого. Чистка стору тут
      // раніше стирала обʼєкти в документі, а отже й у сусідів, і в базі
      flush();
      cancelled = true;
      resumeRef.current = null;
      window.clearTimeout(timer);
      unsubObjects();
      unsubInteracting();
      window.removeEventListener('beforeunload', flush);
      useEditorStore.getState().clearSelection();
    };
  }, [boardId]);

  return status;
}
