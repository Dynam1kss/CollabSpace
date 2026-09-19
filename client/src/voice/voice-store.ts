import { create } from 'zustand';

// стан голосової розмови на цій дошці. Ефемерний, як і присутність: живе,
// поки відкрита вкладка. Сам звук тут не тримаємо — лише те, що показати
export type PeerPhase = 'connecting' | 'live' | 'failed';

export interface PeerInfo {
  phase: PeerPhase;
  // 0..1, порахована з відстані між стільцями. Тримаємо в сторі не лише
  // заради звуку: видно, кого зараз чути, а кого вже ні
  volume: number;
}

interface VoiceState {
  // чи я сам зараз у розмові
  inVoice: boolean;
  // чи мікрофон ще тільки просять у браузера
  starting: boolean;
  // хто ще в розмові (clientId), незалежно від того, чи вже встиг зʼєднатись
  peers: Record<number, PeerInfo>;
  // не вдалось узяти мікрофон — показуємо причину, а не мовчимо
  error: string | null;
  // свій мікрофон вимкнено (доріжку не знімаємо, лише глушимо)
  micMuted: boolean;
  // нікого не чую. Як у дискорді, тягне за собою й свій мікрофон
  deafened: boolean;
  // яким був мікрофон до того, як я заглушив усіх: щоб повернути саме його
  // стан, а не просто увімкнути
  micMutedBeforeDeafen: boolean;
  setInVoice: (value: boolean) => void;
  setStarting: (value: boolean) => void;
  setPeer: (clientId: number, phase: PeerPhase) => void;
  setVolume: (clientId: number, volume: number) => void;
  removePeer: (clientId: number) => void;
  setError: (message: string | null) => void;
  setMicMuted: (muted: boolean) => void;
  setDeafened: (on: boolean, micMutedBefore: boolean) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  inVoice: false,
  starting: false,
  peers: {},
  error: null,
  micMuted: false,
  deafened: false,
  micMutedBeforeDeafen: false,

  setInVoice: (value) => set({ inVoice: value, error: value ? null : undefined }),
  setStarting: (value) => set({ starting: value }),
  setPeer: (clientId, phase) =>
    set((state) => ({
      peers: { ...state.peers, [clientId]: { volume: state.peers[clientId]?.volume ?? 1, phase } },
    })),

  setVolume: (clientId, volume) =>
    set((state) => {
      const peer = state.peers[clientId];
      if (!peer || peer.volume === volume) return state;
      return { peers: { ...state.peers, [clientId]: { ...peer, volume } } };
    }),
  removePeer: (clientId) =>
    set((state) => {
      const peers = { ...state.peers };
      delete peers[clientId];
      return { peers };
    }),
  setError: (message) => set({ error: message }),
  setMicMuted: (micMuted) => set({ micMuted }),
  setDeafened: (deafened, micMutedBeforeDeafen) => set({ deafened, micMutedBeforeDeafen }),
  reset: () =>
    set({
      inVoice: false,
      starting: false,
      peers: {},
      error: null,
      micMuted: false,
      deafened: false,
      micMutedBeforeDeafen: false,
    }),
}));
