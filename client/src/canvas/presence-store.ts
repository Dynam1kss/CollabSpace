import { create } from 'zustand';
import type { PresenceMember } from 'shared';

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
  members: Record<number, PresenceMember>;
  // останнє відоме положення курсора, у координатах дошки
  cursors: Record<number, CursorPoint>;
  // що зараз виділено в кожного — id обʼєктів
  selections: Record<number, string[]>;
  setRoster: (selfClientId: number, members: PresenceMember[]) => void;
  addMember: (member: PresenceMember) => void;
  removeMember: (clientId: number) => void;
  setCursor: (clientId: number, point: CursorPoint) => void;
  setSelection: (clientId: number, selectedIds: string[]) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  selfClientId: null,
  members: {},
  cursors: {},
  selections: {},

  setRoster: (selfClientId, members) =>
    set({
      selfClientId,
      members: Object.fromEntries(members.map((m) => [m.clientId, m])),
      cursors: {},
      selections: {},
    }),

  addMember: (member) => set((state) => ({ members: { ...state.members, [member.clientId]: member } })),

  // курсор прибираємо разом із людиною — не по таймауту: сервер сам каже,
  // коли вона пішла, вгадувати нема чого
  removeMember: (clientId) =>
    set((state) => {
      const members = { ...state.members };
      const cursors = { ...state.cursors };
      const selections = { ...state.selections };
      delete members[clientId];
      delete cursors[clientId];
      delete selections[clientId];
      return { members, cursors, selections };
    }),

  setCursor: (clientId, point) => set((state) => ({ cursors: { ...state.cursors, [clientId]: point } })),

  setSelection: (clientId, selectedIds) =>
    set((state) => ({ selections: { ...state.selections, [clientId]: selectedIds } })),

  reset: () => set({ selfClientId: null, members: {}, cursors: {}, selections: {} }),
}));

// усі, крім мене — саме їх показуємо в списку й малюємо на полотні
export function otherMembers(state: PresenceState) {
  return Object.values(state.members).filter((m) => m.clientId !== state.selfClientId);
}
