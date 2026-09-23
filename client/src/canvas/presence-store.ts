import { useMemo } from 'react';
import { create } from 'zustand';
import type { BoardRole, PresenceMember, ViewportMessage } from 'shared';

// хто зараз на дошці. Стан суто ефемерний: живе, поки відкрита вкладка, у
// Y.Doc і в базу не потрапляє. Джерело правди — сервер: він шле список при
// підключенні і події входу/виходу, клієнт нічого не вигадує сам
export interface CursorPoint {
  x: number;
  y: number;
}

interface PresenceState {
  // мій clientId із roster — щоб не малювати себе серед «інших»
  selfClientId: number | null;
  // моя роль на цій дошці за версією сервера. Початково з roster, далі її
  // може змінити власник просто під час сеансу — кадром ROLE
  selfRole: 'OWNER' | BoardRole | null;
  members: Record<number, PresenceMember>;
  // останнє відоме положення курсора, у координатах дошки
  cursors: Record<number, CursorPoint>;
  // що зараз виділено в кожного — id обʼєктів
  selections: Record<number, string[]>;
  // хто який обʼєкт зараз редагує (clientId → id обʼєкта). Щонайбільше один
  // на людину, тому не масив
  locks: Record<number, string>;
  // видиме вікно тих, хто зайшов з тача — замість курсора, якого в них нема
  viewports: Record<number, ViewportMessage>;
  setRoster: (selfClientId: number, members: PresenceMember[]) => void;
  addMember: (member: PresenceMember) => void;
  removeMember: (clientId: number) => void;
  setCursor: (clientId: number, point: CursorPoint) => void;
  setSelection: (clientId: number, selectedIds: string[]) => void;
  setLock: (clientId: number, objectId: string | null) => void;
  setViewport: (clientId: number, rect: ViewportMessage) => void;
  setSelfRole: (role: 'OWNER' | BoardRole) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  selfClientId: null,
  selfRole: null,
  members: {},
  cursors: {},
  selections: {},
  locks: {},
  viewports: {},

  setRoster: (selfClientId, members) =>
    set({
      selfClientId,
      selfRole: members.find((m) => m.clientId === selfClientId)?.role ?? null,
      members: Object.fromEntries(members.map((m) => [m.clientId, m])),
      cursors: {},
      selections: {},
      locks: {},
      viewports: {},
    }),

  addMember: (member) => set((state) => ({ members: { ...state.members, [member.clientId]: member } })),

  // курсор прибираємо разом із людиною — не по таймауту: сервер сам каже,
  // коли вона пішла, вгадувати нема чого
  removeMember: (clientId) =>
    set((state) => {
      const members = { ...state.members };
      const cursors = { ...state.cursors };
      const selections = { ...state.selections };
      // замок зникає разом із людиною — саме тому окремий таймаут не потрібен:
      // вкладка, яка впала, лишає по собі LEAVE, а з ним і звільнений обʼєкт
      const locks = { ...state.locks };
      const viewports = { ...state.viewports };
      delete members[clientId];
      delete cursors[clientId];
      delete selections[clientId];
      delete locks[clientId];
      delete viewports[clientId];
      return { members, cursors, selections, locks, viewports };
    }),

  setCursor: (clientId, point) => set((state) => ({ cursors: { ...state.cursors, [clientId]: point } })),

  setSelection: (clientId, selectedIds) =>
    set((state) => ({ selections: { ...state.selections, [clientId]: selectedIds } })),

  setLock: (clientId, objectId) =>
    set((state) => {
      const locks = { ...state.locks };
      if (objectId === null) delete locks[clientId];
      else locks[clientId] = objectId;
      return { locks };
    }),

  setViewport: (clientId, rect) =>
    set((state) => ({ viewports: { ...state.viewports, [clientId]: rect } })),

  setSelfRole: (role) => set({ selfRole: role }),

  reset: () =>
    set({
      selfClientId: null,
      selfRole: null,
      members: {},
      cursors: {},
      selections: {},
      locks: {},
      viewports: {},
    }),
}));

// усі, крім мене — саме їх показуємо в списку й малюємо на полотні
export function otherMembers(state: PresenceState) {
  return Object.values(state.members).filter((m) => m.clientId !== state.selfClientId);
}

// обʼєкти, які зараз тримає хтось інший. Поки людина в обʼєкті друкує, решта
// його не чіпає взагалі — ні стилем, ні розміром, ні видаленням: інакше можна
// змінити колір чи знести стікер просто з-під того, хто в ньому пише
export function lockedObjectIds(state: Pick<PresenceState, 'locks' | 'selfClientId'>) {
  const ids = new Set<string>();
  for (const [key, objectId] of Object.entries(state.locks)) {
    if (Number(key) !== state.selfClientId) ids.add(objectId);
  }
  return ids;
}

export function useLockedByOthers() {
  const locks = usePresenceStore((s) => s.locks);
  const selfClientId = usePresenceStore((s) => s.selfClientId);
  return useMemo(() => lockedObjectIds({ locks, selfClientId }), [locks, selfClientId]);
}

// хто тримає обʼєкт зайнятим — не рахуючи мене самого: свій же замок
// редагувати не заважає
export function lockOwner(state: PresenceState, objectId: string) {
  for (const [key, id] of Object.entries(state.locks)) {
    const clientId = Number(key);
    if (id === objectId && clientId !== state.selfClientId) return state.members[clientId] ?? null;
  }
  return null;
}
