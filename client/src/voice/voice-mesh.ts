import { VOICE_MAX_PARTICIPANTS } from 'shared';
import type { IceConfigResponse, VoiceIceMessage, VoiceSdpMessage } from 'shared';
import { fetchIceConfig } from '../api/boards';
import { usePresenceStore } from '../canvas/presence-store';
import { publishVoiceState, sendVoiceIce, sendVoiceSdp } from './voice-channel';
import { useVoiceStore } from './voice-store';

// mesh: кожен зʼєднується з кожним напряму, сервер лише зводить їх. Через це
// кількість зʼєднань росте квадратично — звідси й стеля в шість учасників
// (docs/ТЗ.md). Це не захист, а межа якості: клієнт, який її обійде, зіпсує
// розмову насамперед собі, тому сервер її не стереже

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  // кандидати, що прийшли раніше за опис зʼєднання — їх не можна додавати
  // до setRemoteDescription, інакше браузер лається й губить їх
  pendingIce: VoiceIceMessage[];
}

const peers = new Map<number, Peer>();
let localStream: MediaStream | null = null;
let iceConfig: IceConfigResponse | null = null;

function selfId() {
  return usePresenceStore.getState().selfClientId;
}

// правило, яке робить зіткнення пропозицій (glare) неможливим: пропонує
// завжди той, у кого менший clientId. Лічильник у сервера лише росте, тому
// «менший» — це «був тут раніше», і для будь-якої пари напрямок один.
// У спайку ту саму роль грав прапорець polite, але лише для двох
function shouldOffer(peerClientId: number) {
  const me = selfId();
  return me !== null && me < peerClientId;
}

// елемент потрібен лише як приймач звуку — показувати нема чого.
// У кроці C між ним і колонками стане GainNode
function attachAudio() {
  const audio = new Audio();
  audio.autoplay = true;
  audio.style.display = 'none';
  document.body.append(audio);
  return audio;
}

function createPeer(clientId: number) {
  const existing = peers.get(clientId);
  if (existing) return existing;
  if (!localStream || !iceConfig) return null;

  const pc = new RTCPeerConnection({
    iceServers: iceConfig.iceServers,
    iceTransportPolicy: iceConfig.iceTransportPolicy,
  });
  const peer: Peer = { pc, audio: attachAudio(), pendingIce: [] };
  peers.set(clientId, peer);
  useVoiceStore.getState().setPeer(clientId, 'connecting');

  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    sendVoiceIce(clientId, {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      usernameFragment: candidate.usernameFragment,
    });
  };

  pc.ontrack = ({ streams }) => {
    peer.audio.srcObject = streams[0] ?? null;
    void peer.audio.play().catch(() => {
      // автовідтворення без жесту: вхід у розмову сам по собі жест, тому
      // сюди доходить хіба що на дуже суворих налаштуваннях
    });
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') useVoiceStore.getState().setPeer(clientId, 'live');
    else if (state === 'failed') useVoiceStore.getState().setPeer(clientId, 'failed');
  };

  return peer;
}

async function offerTo(clientId: number) {
  const peer = createPeer(clientId);
  if (!peer) return;
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  sendVoiceSdp(clientId, { type: 'offer', sdp: peer.pc.localDescription?.sdp ?? '' });
}

// чужий стан розмови змінився (або сервер переспівав його нам на вході)
export function handleVoiceState(clientId: number, inVoice: boolean) {
  if (!inVoice) {
    dropPeer(clientId);
    return;
  }
  useVoiceStore.getState().setPeer(clientId, 'connecting');
  // поки я сам не в розмові, просто запамʼятовуємо його в списку
  if (!useVoiceStore.getState().inVoice) return;
  if (peers.has(clientId)) return;
  if (shouldOffer(clientId)) void offerTo(clientId);
}

export async function handleVoiceSdp(clientId: number, message: VoiceSdpMessage) {
  if (!useVoiceStore.getState().inVoice) return;
  const peer = createPeer(clientId);
  if (!peer) return;

  await peer.pc.setRemoteDescription({ type: message.type, sdp: message.sdp });
  for (const candidate of peer.pendingIce.splice(0)) {
    await peer.pc.addIceCandidate(candidate).catch(() => {});
  }
  if (message.type !== 'offer') return;

  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);
  sendVoiceSdp(clientId, { type: 'answer', sdp: peer.pc.localDescription?.sdp ?? '' });
}

export async function handleVoiceIce(clientId: number, message: VoiceIceMessage) {
  const peer = peers.get(clientId);
  if (!peer) return;
  // опису ще нема — кандидат почекає, інакше браузер його відкине
  if (!peer.pc.remoteDescription) {
    peer.pendingIce.push(message);
    return;
  }
  await peer.pc.addIceCandidate(message).catch(() => {});
}

// людина пішла з дошки: окремого сигналу «вийшов з голосу» не треба, той
// самий LEAVE присутності каже все
export function dropPeer(clientId: number) {
  const peer = peers.get(clientId);
  if (!peer) return;
  peers.delete(clientId);
  peer.pc.onicecandidate = null;
  peer.pc.ontrack = null;
  peer.pc.onconnectionstatechange = null;
  peer.pc.close();
  peer.audio.srcObject = null;
  peer.audio.remove();
  useVoiceStore.getState().removePeer(clientId);
}

export async function startVoice() {
  const store = useVoiceStore.getState();
  if (store.inVoice || store.starting) return;
  store.setStarting(true);
  try {
    // відео нема й не планується — docs/ТЗ.md обмежує голосом
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    iceConfig = await fetchIceConfig();
  } catch {
    useVoiceStore.getState().setStarting(false);
    useVoiceStore.getState().setError('Не вдалося увімкнути мікрофон');
    return;
  }
  useVoiceStore.getState().setStarting(false);
  useVoiceStore.getState().setInVoice(true);
  // сервер у відповідь переспіває нам тих, хто вже в розмові, і розкаже
  // про нас решті — далі напрямок пропозицій вирішує shouldOffer
  publishVoiceState(true);
}

export function stopVoice() {
  if (!useVoiceStore.getState().inVoice) return;
  publishVoiceState(false);
  for (const clientId of [...peers.keys()]) dropPeer(clientId);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  useVoiceStore.getState().setInVoice(false);
}

// зміна дошки чи розрив сокета: розмову тут не продовжити
export function resetVoice() {
  for (const clientId of [...peers.keys()]) dropPeer(clientId);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  useVoiceStore.getState().reset();
}

export function voiceIsFull() {
  const { peers: known, inVoice } = useVoiceStore.getState();
  return Object.keys(known).length + (inVoice ? 1 : 0) >= VOICE_MAX_PARTICIPANTS;
}
