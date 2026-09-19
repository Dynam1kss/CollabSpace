import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import { publishLock, publishSelection, republishViewport, setPresenceSender } from './presence-channel';
import { useEditorStore } from './editor-store';
import type {
  ChatMessageInfo,
  LeaveMessage,
  LockMessage,
  PresenceMember,
  RoleChangedMessage,
  RosterMessage,
  VoiceIceMessage,
  VoiceSdpMessage,
  VoiceStateMessage,
  ViewportMessage,
} from 'shared';
import { useChatStore } from './chat-store';
import {
  dropPeer,
  handleVoiceIce,
  handleVoiceSdp,
  handleVoiceState,
  resetVoice,
} from '../voice/voice-mesh';
import { resetBoardDoc } from './board-store';
import { usePresenceStore } from './presence-store';

// 'kicked' — не різновид обриву, а окрема причина: власник забрав доступ.
// Сокет після цього теж закриється, але сторінці треба сказати інше
export type SyncStatus = 'connecting' | 'live' | 'offline' | 'kicked';

// позначка на вхідних оновленнях: doc.on('update') бачить origin і не шле
// їх назад у мережу — інакше чуже оновлення поверталось би по колу
const REMOTE_ORIGIN = { source: 'network' };

// sync-запит повторюємо, поки не відповіли: сервер адресує його одному
// «найстаршому» редактору, і якщо той обірвався без FIN, запит просто зникає.
// сервер вибиває мертвий сокет за два такти по 10с — за цей час устигне
// прийти або його відповідь, або серверне «нема кому відповідати»
const SYNC_RETRY_MS = 3000;

const decoder = new TextDecoder();
function text(bytes: Uint8Array) {
  return decoder.decode(bytes);
}

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
    // присутність — ефемерна й прив'язана до цього сокета: на новій дошці
    // починаємо з порожнього списку, чужі записи зі старої кімнати не тягнемо
    usePresenceStore.getState().reset();
    resetVoice();
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws/boards/${boardId}`);
    ws.binaryType = 'arraybuffer';

    function send(data: Uint8Array) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
    // курсор і виділення підуть тим самим сокетом
    setPresenceSender(send);
    // своє виділення — на кожну зміну; кадри рідкі, тримати їх нема сенсу.
    // так само й замок: зайшов у текст — зайняв обʼєкт, вийшов — відпустив
    const unsubSelection = useEditorStore.subscribe((state, prev) => {
      if (state.selectedIds !== prev.selectedIds) publishSelection(state.selectedIds);
      if (state.editingTextId !== prev.editingTextId) publishLock(state.editingTextId);
    });

    // сокет закриє сам сервер одразу по кадру — щоб onclose не перебив
    // причину звичайним «офлайн»
    let kicked = false;

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
        case SYNC_MSG.ROSTER: {
          const roster = JSON.parse(text(payload)) as RosterMessage;
          usePresenceStore.getState().setRoster(roster.you, roster.members);
          return;
        }
        case SYNC_MSG.JOIN:
          usePresenceStore.getState().addMember(JSON.parse(text(payload)) as PresenceMember);
          // новачок про чуже виділення, замок і вікно нізвідки не дізнається —
          // вони могли не мінятись годину. Тому на кожен вхід переспівуємо своє
          publishSelection(useEditorStore.getState().selectedIds);
          publishLock(useEditorStore.getState().editingTextId);
          republishViewport();
          return;
        case SYNC_MSG.LEAVE: {
          const { clientId } = JSON.parse(text(payload)) as LeaveMessage;
          usePresenceStore.getState().removeMember(clientId);
          // окремого «вийшов з голосу» не треба: пішов з дошки — пішов звідусіль
          dropPeer(clientId);
          return;
        }
        case SYNC_MSG.SELECTION: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const ids = JSON.parse(text(payload.subarray(SYNC_REQUESTER_ID_BYTES))) as string[];
          usePresenceStore.getState().setSelection(view.getUint32(0), ids);
          return;
        }
        case SYNC_MSG.LOCK: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const body = JSON.parse(text(payload.subarray(SYNC_REQUESTER_ID_BYTES))) as LockMessage;
          const owner = view.getUint32(0);
          usePresenceStore.getState().setLock(owner, body.objectId);
          // рідкісна нічия: обидва зайшли в той самий обʼєкт, поки кадри
          // летіли назустріч. Розходимось за clientId — менший лишається,
          // більший виходить; правило однакове в обох, тому обидва зійдуться
          const me = usePresenceStore.getState().selfClientId;
          const editing = useEditorStore.getState().editingTextId;
          if (body.objectId && body.objectId === editing && me !== null && owner < me) {
            useEditorStore.getState().stopEditingText();
          }
          return;
        }

        case SYNC_MSG.KICKED:
          kicked = true;
          setStatus('kicked');
          return;

        case SYNC_MSG.ROLE: {
          // власник змінив мені роль просто зараз. Сам прапорець їде в
          // presence-store, а звідти — у canEdit через BoardPage; тут лишається
          // прибрати за собою те, чого глядачу вже не можна
          const { role } = JSON.parse(text(payload)) as RoleChangedMessage;
          usePresenceStore.getState().setSelfRole(role);
          if (role === 'VIEWER') {
            // з тексту виходимо тим самим шляхом, що й при програші за замок:
            // stopEditingText відпускає і сам замок, підпискою нижче
            useEditorStore.getState().stopEditingText();
            useEditorStore.getState().clearSelection();
          }
          return;
        }

        case SYNC_MSG.VOICE_STATE: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const body = JSON.parse(
            text(payload.subarray(SYNC_REQUESTER_ID_BYTES)),
          ) as VoiceStateMessage;
          handleVoiceState(view.getUint32(0), body.inVoice);
          return;
        }

        case SYNC_MSG.VOICE_SDP: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const body = JSON.parse(text(payload.subarray(SYNC_REQUESTER_ID_BYTES))) as VoiceSdpMessage;
          void handleVoiceSdp(view.getUint32(0), body);
          return;
        }

        case SYNC_MSG.VOICE_ICE: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const body = JSON.parse(text(payload.subarray(SYNC_REQUESTER_ID_BYTES))) as VoiceIceMessage;
          void handleVoiceIce(view.getUint32(0), body);
          return;
        }

        case SYNC_MSG.CHAT:
          // сюди долітає і власне повідомлення — сервер шле його всім, бо id
          // і час призначає база
          useChatStore.getState().addMessage(JSON.parse(text(payload)) as ChatMessageInfo);
          return;

        case SYNC_MSG.VIEWPORT: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          const rect = JSON.parse(text(payload.subarray(SYNC_REQUESTER_ID_BYTES))) as ViewportMessage;
          usePresenceStore.getState().setViewport(view.getUint32(0), rect);
          return;
        }

        case SYNC_MSG.CURSOR: {
          const view = new DataView(data.buffer, data.byteOffset + 1);
          usePresenceStore
            .getState()
            .setCursor(view.getUint32(0), { x: view.getFloat32(4), y: view.getFloat32(8) });
          return;
        }
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
      if (kicked) return;
      // присутність приходить лише цим сокетом. Поки він був живий, список
      // був правдою; тепер про кімнату не відомо нічого, і лишати останній
      // знімок висіти — гірше, ніж не показувати нікого: людина бачить
      // курсори й кружечки тих, хто давно вийшов, і вірить їм. Своє виділення
      // й замок теж нікуди більше не йдуть
      usePresenceStore.getState().reset();
      setStatus('offline');
    };
    ws.onclose = dropped;
    ws.onerror = dropped;

    return () => {
      window.clearInterval(syncRetry);
      unsubSelection();
      setPresenceSender(null);
      usePresenceStore.getState().reset();
      resetVoice();
      setPresenceSender(send);
      doc.off('update', handleLocalUpdate);
      // своє закриття — не «офлайн»
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    };
  }, [boardId]);

  return status;
}
