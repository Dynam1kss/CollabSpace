import { useEffect } from 'react';
import { fetchMySeat, saveMySeat } from '../api/boards';
import { publishSeat } from '../canvas/presence-channel';
import { defaultSeat } from './seat-position';
import { useSeatStore } from './seat-store';

// своє місце: вантажимо з бази при відкритті дошки, показуємо решті живим
// кадром, записуємо назад після того, як відпустили. Позиція переживає
// перезаходи навмисно — це не миттєвий показник, як курсор, а домовленість
// «я сиджу отут», і губити її на кожному оновленні сторінки означало б
// зробити з неї ще один курсор
export function useMySeat(boardId: string, currentUserId: string) {
  useEffect(() => {
    let cancelled = false;
    fetchMySeat(boardId)
      .then(({ seat }) => {
        if (cancelled) return;
        // першого разу садимо на стале місце від id і одразу записуємо —
        // щоб наступного разу воно вже було своє
        const mine = seat ?? defaultSeat(currentUserId);
        useSeatStore.getState().setMine(mine);
        publishSeat(mine);
        if (!seat) void saveMySeat(boardId, mine).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [boardId, currentUserId]);

  return () => {
    const mine = useSeatStore.getState().mine;
    if (mine) void saveMySeat(boardId, mine).catch(() => {});
  };
}
