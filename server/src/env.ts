import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env в корені, не в server/, тому шлях явно
config({ path: resolve(__dirname, '../../.env') });

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  if (isProduction) {
    throw new Error('JWT_SECRET не задано — обовʼязковий у продакшені');
  }
  console.warn('JWT_SECRET не задано в .env, використовується тестовий секрет — тільки для розробки');
}

// конфіг ICE для spike/webrtc — щоб прогнати той самий дослід спершу без TURN,
// потім з ним, без правок коду. За замовчуванням тільки публічний STUN
const iceStunUrls = (process.env.ICE_STUN_URLS ?? 'stun:stun.l.google.com:19302')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

// relay — примусово через TURN (прямі й STUN-кандидати заборонені), щоб
// перевірити сам TURN-сервер окремо від мережі перед висновками про CGNAT/NAT
const iceTransportPolicy: 'all' | 'relay' =
  process.env.ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';

// скільки проксі-хопів перед express — від цього залежить, який адресу він
// візьме за req.ip (по ньому рахує ліміт спроб логіну). в розробці 1: тунель
// на телефон додає X-Forwarded-For, vite-проксі його лише передає, тож запис
// там один; без тунелю заголовка нема і req.ip лишається адресою сокета.
// у проді 0 — у docker compose перед сервером зараз нічого не стоїть, а
// `true` довіряло б X-Forwarded-For від кого завгодно, і ліміт логінів
// обходився б підробленим заголовком. зʼявиться nginx — виставити TRUST_PROXY=1
const trustProxy = Number(process.env.TRUST_PROXY ?? (isProduction ? 0 : 1)) || 0;

export const env = {
  port: Number(process.env.PORT) || 3000,
  trustProxy,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-not-for-production',
  isProduction,
  iceStunUrls,
  iceTurnUrl: process.env.ICE_TURN_URL?.trim() || null,
  iceTurnUsername: process.env.ICE_TURN_USERNAME?.trim() || undefined,
  iceTurnCredential: process.env.ICE_TURN_CREDENTIAL?.trim() || undefined,
  iceTransportPolicy,
};
