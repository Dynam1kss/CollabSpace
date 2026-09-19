import { VOICE_MAX_PARTICIPANTS } from 'shared';
import type { IceConfigResponse, VoiceIceMessage, VoiceSdpMessage } from 'shared';
import { fetchIceConfig } from '../api/boards';
import { usePresenceStore } from '../canvas/presence-store';
import { useSeatStore } from './seat-store';
import { seatDistance, spatialGain } from './spatial-gain';
import { publishVoiceState, sendVoiceIce, sendVoiceSdp } from './voice-channel';
import { useVoiceStore } from './voice-store';

// mesh: кожен зʼєднується з кожним напряму, сервер лише зводить їх. Через це
// кількість зʼєднань росте квадратично — звідси й стеля в шість учасників
// (docs/ТЗ.md). Це не захист, а межа якості: клієнт, який її обійде, зіпсує
// розмову насамперед собі, тому сервер її не стереже

interface Peer {
  pc: RTCPeerConnection;
  // елемент лишається, але мовчить: звук іде графом web audio, щоб між
  // потоком і колонками стояв регулятор гучності. Відчепити його зовсім не
  // можна — chromium не віддає віддалений потік у web audio, поки той не
  // прикріплений до медіаелемента
  audio: HTMLAudioElement;
  gain: GainNode | null;
  // потрібен, щоб зібрати граф наново, якщо контекст доведеться перестворити
  stream: MediaStream | null;
  // кандидати, що прийшли раніше за опис зʼєднання — їх не можна додавати
  // до setRemoteDescription, інакше браузер лається й губить їх
  pendingIce: VoiceIceMessage[];
}

const peers = new Map<number, Peer>();
let localStream: MediaStream | null = null;
let iceConfig: IceConfigResponse | null = null;
let audioCtx: AudioContext | null = null;
// поки триває розмова, стежимо за стільцями: посунув свій чи чужий — гучність
// має поїхати одразу, а не після перепідключення
let unsubscribeSeats: (() => void) | null = null;

// різку зміну підсилення чути як тріск, тому доводимо плавно
const GAIN_RAMP_SECONDS = 0.08;

// доріжка мікрофона після повернення з фону буває коротко muted і сама
// відходить. Даємо їй цей час, перш ніж перезапитувати мікрофон
const TRACK_SETTLE_MS = 400;

let unsubscribeVisibility: (() => void) | null = null;

function context() {
  audioCtx ??= new AudioContext();
  return audioCtx;
}

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

// потік → регулятор гучності → колонки. Винесено окремо, бо цей самий граф
// доводиться збирати наново, коли сафарі закриває контекст у фоні
function wireAudio(peer: Peer) {
  if (!peer.stream) return;
  const ctx = context();
  void ctx.resume().catch(() => {});
  peer.gain?.disconnect();
  const gain = ctx.createGain();
  gain.gain.value = 1;
  ctx.createMediaStreamSource(peer.stream).connect(gain).connect(ctx.destination);
  peer.gain = gain;
}

function createPeer(clientId: number) {
  const existing = peers.get(clientId);
  if (existing) return existing;
  if (!localStream || !iceConfig) return null;

  const pc = new RTCPeerConnection({
    iceServers: iceConfig.iceServers,
    iceTransportPolicy: iceConfig.iceTransportPolicy,
  });
  const peer: Peer = { pc, audio: attachAudio(), gain: null, stream: null, pendingIce: [] };
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
    const stream = streams[0] ?? null;
    peer.audio.srcObject = stream;
    // сам елемент мовчить — грає граф нижче
    peer.audio.muted = true;
    void peer.audio.play().catch(() => {});
    if (!stream) return;
    peer.stream = stream;
    wireAudio(peer);
    applySpatialGain();
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') useVoiceStore.getState().setPeer(clientId, 'live');
    else if (state === 'failed') useVoiceStore.getState().setPeer(clientId, 'failed');
  };

  return peer;
}

// гучність кожного співрозмовника з відстані між нашими стільцями. Відстань
// у координатах дошки, тому зум ні на що не впливає
export function applySpatialGain() {
  const { mine, others } = useSeatStore.getState();
  // «нікого не чую» — це множник поверх просторової гучності, а не заміна їй:
  // сама гучність від відстані далі рахується й лишається в сторі, тож після
  // вимкнення чути рівно те, що чулось би й без нього
  const master = useVoiceStore.getState().deafened ? 0 : 1;
  for (const [clientId, peer] of peers) {
    const theirs = others[clientId];
    const volume = mine && theirs ? spatialGain(seatDistance(mine, theirs)) : 1;
    useVoiceStore.getState().setVolume(clientId, volume);
    if (!peer.gain || !audioCtx) continue;
    peer.gain.gain.setTargetAtTime(volume * master, audioCtx.currentTime, GAIN_RAMP_SECONDS);
  }
}

// доріжку не знімаємо й не перепідключаємо — лише глушимо. Тому вмикається
// вона миттєво й без переговорів
export function setMicMuted(muted: boolean) {
  localStream?.getAudioTracks().forEach((track) => {
    track.enabled = !muted;
  });
  useVoiceStore.getState().setMicMuted(muted);
}

// як у дискорді: «не чую» тягне за собою й «не говорю», а на виході
// повертає мікрофон у той стан, у якому він був до цього
export function setDeafened(on: boolean) {
  const store = useVoiceStore.getState();
  if (on === store.deafened) return;
  if (on) {
    store.setDeafened(true, store.micMuted);
    setMicMuted(true);
  } else {
    store.setDeafened(false, store.micMutedBeforeDeafen);
    setMicMuted(store.micMutedBeforeDeafen);
  }
  applySpatialGain();
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
  peer.gain?.disconnect();
  peer.gain = null;
  peer.audio.srcObject = null;
  peer.audio.remove();
  useVoiceStore.getState().removePeer(clientId);
}

// сафарі, коли вкладка йде у фон (зокрема — у прихований Tab Group), глушить
// і приймання, і передавання: AudioContext переходить у 'suspended' або в
// нестандартний для webkit стан 'interrupted', а доріжку мікрофона система
// позначає muted. Сокет при цьому живий — pong на ping браузер відповідає сам,
// у мережевому шарі, без участі js, тому ні присутність, ні дошка не рвуться,
// і жнець мертвих сокетів такого клієнта не бачить. Тобто це не проблема
// сокета, а суто шар WebRTC/Web Audio, і вона не лікується сама: нічого в
// застосунку не вмикало звук назад, поки людина не перезаходила в розмову
async function recoverAudio() {
  if (!useVoiceStore.getState().inVoice) return;

  // 1. контекст. 'closed' — стан безповоротний, тоді збираємо граф наново
  if (audioCtx && audioCtx.state === 'closed') {
    audioCtx = null;
    for (const peer of peers.values()) {
      peer.gain = null;
      wireAudio(peer);
    }
    applySpatialGain();
  } else if (audioCtx && audioCtx.state !== 'running') {
    await audioCtx.resume().catch(() => {});
  }

  // 2. елементи-приймачі: у фоні їх ставлять на паузу
  for (const peer of peers.values()) {
    if (peer.audio.paused) void peer.audio.play().catch(() => {});
  }

  // 3. свій мікрофон. Закінчену доріжку міняємо одразу, приглушеній даємо
  // мить отямитись — після повернення з фону вона часто відходить сама
  let track = localStream?.getAudioTracks()[0] ?? null;
  if (track?.muted) {
    await new Promise((resolve) => setTimeout(resolve, TRACK_SETTLE_MS));
    track = localStream?.getAudioTracks()[0] ?? null;
  }
  if (!track || track.readyState === 'ended' || track.muted) {
    await replaceLocalTrack();
  }

  // 4. самі зʼєднання. Пропонує той, хто й мав би — правило те саме, що на
  // вході в розмову, тому зустрічних пропозицій не буде й тут
  for (const [clientId, peer] of peers) {
    const state = peer.pc.connectionState;
    if (state !== 'failed' && state !== 'disconnected') continue;
    if (!shouldOffer(clientId)) continue;
    peer.pc.restartIce();
    await offerTo(clientId).catch(() => {});
  }
}

// беремо мікрофон наново й підмінюємо доріжку в кожному зʼєднанні: так
// переговори не потрібні, зʼєднання лишаються ті самі
async function replaceLocalTrack() {
  let fresh: MediaStream;
  try {
    fresh = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    useVoiceStore.getState().setError('Мікрофон не повернувся — перезайдіть у розмову');
    return;
  }
  const track = fresh.getAudioTracks()[0] ?? null;
  for (const peer of peers.values()) {
    const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (sender && track) await sender.replaceTrack(track).catch(() => {});
  }
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = fresh;
}

// повернення вкладки на очі — єдиний момент, коли це можна полагодити.
// pageshow потрібен окремо: вихід із bfcache не дає visibilitychange
function watchVisibility() {
  if (unsubscribeVisibility) return;
  const onVisible = () => {
    if (document.visibilityState === 'visible') void recoverAudio();
  };
  const onPageShow = () => void recoverAudio();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  unsubscribeVisibility = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
  };
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
  unsubscribeSeats ??= useSeatStore.subscribe(applySpatialGain);
  watchVisibility();
  // сервер у відповідь переспіває нам тих, хто вже в розмові, і розкаже
  // про нас решті — далі напрямок пропозицій вирішує shouldOffer
  publishVoiceState(true);
}

export function stopVoice() {
  if (!useVoiceStore.getState().inVoice) return;
  publishVoiceState(false);
  unsubscribeSeats?.();
  unsubscribeSeats = null;
  unsubscribeVisibility?.();
  unsubscribeVisibility = null;
  for (const clientId of [...peers.keys()]) dropPeer(clientId);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  useVoiceStore.getState().setInVoice(false);
}

// зміна дошки чи розрив сокета: розмову тут не продовжити
export function resetVoice() {
  unsubscribeSeats?.();
  unsubscribeSeats = null;
  unsubscribeVisibility?.();
  unsubscribeVisibility = null;
  for (const clientId of [...peers.keys()]) dropPeer(clientId);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  useVoiceStore.getState().reset();
}

export function voiceIsFull() {
  const { peers: known, inVoice } = useVoiceStore.getState();
  return Object.keys(known).length + (inVoice ? 1 : 0) >= VOICE_MAX_PARTICIPANTS;
}
