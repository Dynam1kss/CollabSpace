import { create } from 'zustand';
import type { PresenceMember } from 'shared';

// хто зараз на дошці. Стан суто ефемерний: живе, поки відкрита вкладка, у
// Y.Doc і в базу не потрапляє. Джерело правди — сервер: він шле список при
// підключенні і події входу/виходу, клієнт нічого не вигадує сам
interface PresenceState {
  // мій clientId із roster — щоб не малювати себе серед «інших»
  selfClientId: number | null;
  members: Record<number, PresenceMember>;
  setRoster: (selfClientId: number, members: PresenceMember[]) => void;
  addMember: (member: PresenceMember) => void;
  removeMember: (clientId: number) => void;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  selfClientId: null,
  members: {},

  setRoster: (selfClientId, members) =>
    set({ selfClientId, members: Object.fromEntries(members.map((m) => [m.clientId, m])) }),

  addMember: (member) => set((state) => ({ members: { ...state.members, [member.clientId]: member } })),

  removeMember: (clientId) =>
    set((state) => {
      const members = { ...state.members };
      delete members[clientId];
      return { members };
    }),

  reset: () => set({ selfClientId: null, members: {} }),
}));

// усі, крім мене — саме їх показуємо в списку й малюємо на полотні
export function otherMembers(state: PresenceState) {
  return Object.values(state.members).filter((m) => m.clientId !== state.selfClientId);
}
