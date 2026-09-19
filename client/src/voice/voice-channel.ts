import { SYNC_MSG, SYNC_REQUESTER_ID_BYTES } from 'shared';
import type { VoiceIceMessage, VoiceSdpMessage } from 'shared';
import { sendBoardFrame } from '../canvas/presence-channel';

// кадри голосу складаються тут; сам сокет один на дошку й живе в
// presence-channel, тому шлемо через нього, а не заводимо друге зʼєднання
function jsonFrame(type: number, payload: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(1 + body.length);
  frame[0] = type;
  frame.set(body, 1);
  return frame;
}

// адресний кадр: [тип][кому:u32][json]. Сервер замінить «кому» на «від кого»
// і віддасть адресату — так само, як у sync-запиті
function addressedFrame(type: number, targetClientId: number, payload: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const frame = new Uint8Array(1 + SYNC_REQUESTER_ID_BYTES + body.length);
  frame[0] = type;
  new DataView(frame.buffer).setUint32(1, targetClientId);
  frame.set(body, 1 + SYNC_REQUESTER_ID_BYTES);
  return frame;
}

export function publishVoiceState(inVoice: boolean) {
  sendBoardFrame(jsonFrame(SYNC_MSG.VOICE_STATE, { inVoice }));
}

export function sendVoiceSdp(targetClientId: number, message: VoiceSdpMessage) {
  sendBoardFrame(addressedFrame(SYNC_MSG.VOICE_SDP, targetClientId, message));
}

export function sendVoiceIce(targetClientId: number, message: VoiceIceMessage) {
  sendBoardFrame(addressedFrame(SYNC_MSG.VOICE_ICE, targetClientId, message));
}
