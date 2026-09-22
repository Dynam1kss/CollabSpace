import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH } from 'shared';
import { fetchChatHistory } from '../api/boards';
import { useChatStore } from './chat-store';
import { ChatIcon } from './icons';
import { colorForUser } from './presence-colors';
import { publishChat } from './presence-channel';
import { useNarrow } from '../use-narrow';

interface Props {
  boardId: string;
}

// час показуємо лише годину й хвилину: чат дошки — це розмова тут і зараз,
// дата в кожному рядку лише заважала б
function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// чат дошки: кнопка внизу праворуч і панель над нею. Історію тягнемо з rest
// при відкритті дошки, живі повідомлення доносить сокет (useBoardSync)
export function ChatPanel({ boardId }: Props) {
  const messages = useChatStore((s) => s.messages);
  const open = useChatStore((s) => s.open);
  const unread = useChatStore((s) => s.unread);
  const setOpen = useChatStore((s) => s.setOpen);
  const [draft, setDraft] = useState('');
  // на телефоні чат не колонка збоку, а вікно на весь екран
  const narrow = useNarrow();
  const listRef = useRef<HTMLDivElement>(null);

  // історія не чекає ні сокета, ні снепшота: вона тільки дописує в стор, а
  // збіги злиються за id. Тому вантажимо одразу, паралельно з усім іншим
  useEffect(() => {
    const store = useChatStore.getState();
    store.reset();
    let cancelled = false;
    fetchChatHistory(boardId)
      .then(({ messages: history }) => {
        if (!cancelled) useChatStore.getState().setHistory(history);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      useChatStore.getState().reset();
    };
  }, [boardId]);

  // нове повідомлення має бути видно без прокрутки; useLayoutEffect — щоб
  // не блимнуло старою позицією між рендером і прокруткою
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    publishChat(text);
    // у стор не кладемо: повідомлення повернеться від сервера з id і часом
    setDraft('');
  }

  if (!open) {
    return (
      <button
        type="button"
        className="board-island chat-toggle"
        title="Чат"
        aria-label="Чат"
        onClick={() => setOpen(true)}
      >
        <ChatIcon />
        {unread > 0 && <span className="chat-unread">{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }

  return (
    <div className={narrow ? 'board-island chat-panel sheet-full' : 'board-island chat-panel'}>
      <header className="chat-head sheet-head">
        <span>Чат</span>
        <button
          type="button"
          className="icon-button"
          title="Згорнути"
          aria-label="Згорнути"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat-empty">Поки порожньо</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="chat-message">
              <div className="chat-meta">
                <span className="chat-author" style={{ color: colorForUser(message.authorId) }}>
                  {message.displayName}
                </span>
                <span className="chat-time">{timeOf(message.createdAt)}</span>
              </div>
              <p className="chat-text">{message.text}</p>
            </div>
          ))
        )}
      </div>

      <form className="chat-form" onSubmit={send}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="Написати…"
          aria-label="Повідомлення"
        />
        <button type="submit" disabled={!draft.trim()}>
          Надіслати
        </button>
      </form>
    </div>
  );
}
