import { create } from 'zustand';
import type { ChatMessageInfo } from 'shared';

// чат дошки. На відміну від решти станів присутності, цей не ефемерний:
// історія приходить з бази, а живі повідомлення лягають поверх неї. Стор
// тримає лише те, що показати — надсилання йде сокетом через chat-channel
interface ChatState {
  messages: ChatMessageInfo[];
  open: boolean;
  // скільки прийшло, поки панель була закрита — для значка на кнопці
  unread: number;
  setHistory: (messages: ChatMessageInfo[]) => void;
  addMessage: (message: ChatMessageInfo) => void;
  setOpen: (open: boolean) => void;
  reset: () => void;
}

function mergeMessages(a: ChatMessageInfo[], b: ChatMessageInfo[]) {
  const byId = new Map(a.map((m) => [m.id, m]));
  for (const message of b) byId.set(message.id, message);
  // той самий порядок, що й на сервері: за часом, а при збігу — за id
  return [...byId.values()].sort(
    (x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id),
  );
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  open: false,
  unread: 0,

  // історія з rest і живі кадри з сокета йдуть різними шляхами й можуть
  // прийти в будь-якому порядку, тому не замінюємо, а зливаємо: інакше
  // історія, що прийшла другою, затерла б уже отримане живе повідомлення.
  // Гейтити одне одним, як снепшот дошки, тут не треба — чат тільки
  // дописується, а id і час призначає сервер, тож злиття однозначне
  setHistory: (history) =>
    set((state) => ({ messages: mergeMessages(state.messages, history) })),

  // те саме повідомлення може прийти двічі: історія з rest і живий кадр з
  // сокета ходять різними шляхами й можуть накластись на межі підключення
  addMessage: (message) =>
    set((state) => {
      if (state.messages.some((m) => m.id === message.id)) return state;
      return {
        messages: [...state.messages, message],
        unread: state.open ? 0 : state.unread + 1,
      };
    }),

  setOpen: (open) => set(open ? { open, unread: 0 } : { open }),

  reset: () => set({ messages: [], unread: 0 }),
}));
