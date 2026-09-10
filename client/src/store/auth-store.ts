import { create } from 'zustand';
import type { AuthUser } from 'shared';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'guest';
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  setUser: (user) => set({ user, status: user ? 'authenticated' : 'guest' }),
}));
