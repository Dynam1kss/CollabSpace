import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import { resetBoardDoc } from './board-store';

export type SyncStatus = 'connecting' | 'live' | 'offline';

// позначка на вхідних оновленнях: doc.on('update') бачить origin і не шле
// їх назад у мережу — інакше чуже оновлення поверталось би по колу
const REMOTE_ORIGIN = { source: 'network' };

// sync-запит повторюємо, поки не відповіли: сервер адресує його одному
// «найстаршому» редактору, і якщо той обірвався без FIN, запит просто зникає.
// сервер вибиває мертвий сокет за два такти по 10с — за цей час устигне
// прийти або його відповідь, або серверне «нема кому відповідати»
const SYNC_RETRY_MS = 3000;

function frame(type: number, ...parts: Uint8Array[]) {
  const total = parts.reduce((n, p) => n + p.length, 1);
  const out = new Uint8Array(total);
  out[0] = type;
  let offset = 1;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// жива синхронізація документа стору з іншими вкладками тієї ж дошки через
// /ws/boards/:id. Початковий стан і збереження — як і були, через rest-снепшот
// (useBoardPersistence); тут лише дельти між тими, хто зараз онлайн.
// перепідключення поки нема — розрив = 'offline' до перезавантаження.
// 'live' — не «сокет відкрито», а «історія інших у мене вже є»: до відповіді
// на sync-запит документ неповний, чужа дельта в нього не інтегрується, і
// збереження такого стану затирає обʼєкти в базі (журнал 18.09)
export function useBoardSync(boardId: string | null, canWrite: boolean) {
  // статус привʼязаний до дошки: для нової дошки, поки її ефект не відзвітував, — 'connecting'
  const [state, setState] = useState<{ boardId: string | null; status: SyncStatus }>({
    boardId: null,
    status: 'connecting',
  });
  const status: SyncStatus = state.boardId === boardId ? state.status : 'connecting';
  // через ref, щоб зміна прав не перезапускала ефект (він скидає документ)
  const canWriteRef = useRef(canWrite);
  useEffect(() => {
    canWriteRef.current = canWrite;
  }, [canWrite]);

  useEffect(() => {
    if (!boardId) return;
    const setStatus = (value: SyncStatus) => setState({ boardId, status: value });
    // свіжий документ на дошку — до того, як useBoardPersistence (він нижче в
    // BoardPage, тому його ефект іде після цього) почне вантажити снепшот
    const doc = resetBoardDoc();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws/boards/${boardId}`);
    ws.binaryType = 'arraybuffer';

    function send(data: Uint8Array) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }

    // снепшот з rest вантажиться паралельно з рукостисканням сокета і часто
    // встигає лягти в документ раніше — такі оновлення send() просто викидав,
    // і в сусіда назавжди лишалась діра в наших клоках
    let missedWhileConnecting = false;

    // глядач нічого не шле — сервер і так відкинув би, але й пробувати не варто
    function handleLocalUpdate(update: Uint8Array, origin: unknown) {
      if (origin === REMOTE_ORIGIN || !canWriteRef.current) return;
      if (ws.readyState !== WebSocket.OPEN) {
        missedWhileConnecting = true;
        return;
      }
      send(frame(SYNC_MSG.UPDATE, update));
    }
    doc.on('update', handleLocalUpdate);

    // вектор рахуємо на кожен повтор наново — документ міг підрости
    let syncRetry: number | undefined;
    function askForHistory() {
      send(frame(SYNC_MSG.SYNC_REQUEST, Y.encodeStateVector(doc)));
    }

    ws.onopen = () => {
      // віддаємо свій стан цілком — інакше сусід не зможе прийняти жодної
      // нашої наступної дельти: yjs вимагає клоки без пропусків
      if (missedWhileConnecting && canWriteRef.current) {
        missedWhileConnecting = false;
        send(frame(SYNC_MSG.UPDATE, Y.encodeStateAsUpdate(doc)));
      }
      // що в мене вже є → у відповідь прийде все, чого бракує (див. shared/sync)
      askForHistory();
      syncRetry = window.setInterval(askForHistory, SYNC_RETRY_MS);
    };

    ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const data = new Uint8Array(e.data);
      if (data.length === 0) return;
      const payload = data.subarray(1);
      switch (data[0]) {
        case SYNC_MSG.UPDATE:
          Y.applyUpdate(doc, payload, REMOTE_ORIGIN);
          return;
        case SYNC_MSG.SYNC_REPLY:
          // порожня відповідь — сервер каже «відповідати нема кому», віддавати
          // нічого, але рукостискання закрите: далі можна зберігати
          if (payload.length > 0) Y.applyUpdate(doc, payload, REMOTE_ORIGIN);
          window.clearInterval(syncRetry);
          setStatus('live');
          return;
        case SYNC_MSG.SYNC_REQUEST: {
          // мене вибрали відповідати новачкові: його id лишаємо як є, сервер по ньому адресує
          if (!canWriteRef.current) return;
          const requesterId = payload.subarray(0, SYNC_REQUESTER_ID_BYTES);
          const stateVector = payload.subarray(SYNC_REQUESTER_ID_BYTES);
          send(frame(SYNC_MSG.SYNC_REPLY, requesterId, Y.encodeStateAsUpdate(doc, stateVector)));
          return;
        }
      }
    };

    // перепідключення нема, тому закритий сокет уже не оживе — повтори гасимо
    const dropped = () => {
      window.clearInterval(syncRetry);
      setStatus('offline');
    };
    ws.onclose = dropped;
    ws.onerror = dropped;

    return () => {
      window.clearInterval(syncRetry);
      doc.off('update', handleLocalUpdate);
      // своє закриття — не «офлайн»
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    };
  }, [boardId]);

  return status;
}
