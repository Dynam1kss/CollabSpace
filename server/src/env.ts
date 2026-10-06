import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { isSyncStrategy } from 'shared';

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

// пошта для відновлення пароля. У розробці зазвичай порожньо — тоді лист іде
// в консоль (див. mailer), а з docker compose поруч стоїть maildev на 1025.
// У проді без smtp запускатись не даємо: інакше «лист відправлено» був би
// брехнею, і людина просто не змогла б відновити пароль
const smtpHost = process.env.SMTP_HOST?.trim() || null;
if (isProduction && !smtpHost) {
  throw new Error('SMTP_HOST не задано — без пошти відновлення пароля не працює');
}

// звідки брати адресу для посилання в листі: сервер свого зовнішнього імені
// не знає, а Host із запиту підставляти не можна — його підробляють
const appUrl = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

// стенд навантаження (bench/load.mjs) читає з сервера його ж cpu, памʼять і
// склад кімнат. окремим прапорцем, а не за !isProduction: віддавати це наживо
// має лише прогін вимірювань, у решти випадків воно нікому не треба
const benchMetrics = process.env.BENCH_METRICS === '1';

// якою стратегією синхронізації працюють кімнати цього сервера. Вирішує сервер,
// а не браузер: стратегії ходять різними каналами (UPDATE кімнаті дошки проти
// CELL_UPDATE кімнатам клітинок), тож двоє на різних режимах в одній кімнаті
// одне одного просто не чують (журнал 05.10). За замовчуванням aoi — те, чим
// застосунок працює насправді
const syncStrategy = isSyncStrategy(process.env.SYNC_STRATEGY) ? process.env.SYNC_STRATEGY : 'aoi';

// межі для файлів дошки. Одне джерело правди: ці ж числа їдуть у клієнта
// через /api/health, і він перевіряє розмір ДО завантаження. Змінити межу —
// це правка .env і перезапуск, більше нічого
const MB = 1024 * 1024;
const fileMaxBytes = Number(process.env.FILE_MAX_BYTES) || 50 * MB;
const boardFilesMaxBytes = Number(process.env.BOARD_FILES_MAX_BYTES) || 500 * MB;

export const env = {
  port: Number(process.env.PORT) || 3000,
  fileMaxBytes,
  boardFilesMaxBytes,
  benchMetrics,
  syncStrategy,
  trustProxy,
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-not-for-production',
  isProduction,
  iceStunUrls,
  iceTurnUrl: process.env.ICE_TURN_URL?.trim() || null,
  iceTurnUsername: process.env.ICE_TURN_USERNAME?.trim() || undefined,
  iceTurnCredential: process.env.ICE_TURN_CREDENTIAL?.trim() || undefined,
  iceTransportPolicy,
  appUrl,
  smtpHost,
  smtpPort: Number(process.env.SMTP_PORT) || 1025,
  smtpUser: process.env.SMTP_USER?.trim() || undefined,
  smtpPassword: process.env.SMTP_PASSWORD ?? undefined,
  smtpFrom: process.env.SMTP_FROM?.trim() || 'CollabSpace <no-reply@collabspace.local>',
};
