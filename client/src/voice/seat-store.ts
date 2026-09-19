import { create } from 'zustand';
import type { SeatPosition } from 'shared';

// де хто сидить на цій дошці. Чужі місця тримаємо за clientId, як і решту
// присутності: малюємо стільці лише тих, хто зараз на дошці, тому ключ —
// сокет, а не людина. Своє місце окремо: воно живе й до того, як прийде
// roster, і зберігається в базу
interface SeatState {
  mine: SeatPosition | null;
  others: Record<number, SeatPosition>;
  setMine: (seat: SeatPosition) => void;
  setOther: (clientId: number, seat: SeatPosition) => void;
  removeOther: (clientId: number) => void;
  reset: () => void;
}

export const useSeatStore = create<SeatState>((set) => ({
  mine: null,
  others: {},

  setMine: (seat) => set({ mine: seat }),
  setOther: (clientId, seat) => set((state) => ({ others: { ...state.others, [clientId]: seat } })),
  removeOther: (clientId) =>
    set((state) => {
      const others = { ...state.others };
      delete others[clientId];
      return { others };
    }),
  reset: () => set({ mine: null, others: {} }),
}));
