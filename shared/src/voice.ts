// голосовий зв'язок: сигналізація їде тим самим сокетом дошки, сам звук —
// повз сервер, напряму між браузерами (mesh). Сервер у тіла цих кадрів не
// заглядає взагалі: для нього це такі самі непрозорі байти, як оновлення yjs
export const VOICE_MAX_PARTICIPANTS = 6;

// хто зараз у розмові. Кадр ходить в обидва боки: від клієнта — «я зайшов/
// вийшов», від сервера — те саме, але з clientId того, про кого йдеться
export interface VoiceStateMessage {
  inVoice: boolean;
}

// sdp як є, рядком. Тип потрібен, бо offer і answer ходять одним кадром:
// напрямок і так однозначний, але читати лог без нього незручно
export interface VoiceSdpMessage {
  type: 'offer' | 'answer';
  sdp: string;
}

// те саме, що RTCIceCandidateInit, але без залежності від типів браузера —
// shared тягне й сервер, а там DOM немає
export interface VoiceIceMessage {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
}

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceConfigResponse {
  iceServers: IceServerConfig[];
  iceTransportPolicy: 'all' | 'relay';
}
