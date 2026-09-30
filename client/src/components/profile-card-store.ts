import { create } from 'zustand';
import type { ProfileContext, ProfilePerson } from './profile-card';

// картку відкривають і з полотна (konva, поза деревом react), і зі звичайних
// списків — тому не локальний стан кожного місця, а один стор і один
// компонент на застосунок
interface OpenCard {
  person: ProfilePerson;
  context: ProfileContext;
  // точка, від якої розкривається картка — екранні координати кліку
  at: { x: number; y: number };
}

interface ProfileCardState {
  open: OpenCard | null;
}

export const useProfileCardStore = create<ProfileCardState>(() => ({ open: null }));

export function openProfileCard(open: OpenCard) {
  useProfileCardStore.setState({ open });
}

export function closeProfileCard() {
  useProfileCardStore.setState({ open: null });
}

// зручність для обробників кліку: картка йде від самого кружечка, а не від
// того місця, куди випадково влучив курсор
export function anchorOf(e: { currentTarget: Element }) {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.bottom };
}
