import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { isSyncStrategy } from 'shared';
import type { HealthResponse, IceConfigResponse, IceServerConfig } from 'shared';
import { requireAuth } from './auth/auth.middleware';
import { authRouter } from './auth/auth.routes';
import { profileRouter } from './auth/profile.routes';
import { roomStats, setSyncStrategyOfRooms } from './boards/board-rooms';
import { boardsRouter } from './boards/boards.routes';
import { chatRouter } from './boards/chat.routes';
import { filesRouter } from './boards/files.routes';
import { imagesRouter, UPLOADS_DIR } from './boards/images.routes';
import { invitesRouter } from './boards/invites.routes';
import { linkPreviewRouter } from './boards/link-preview.routes';
import { seatsRouter } from './boards/seats.routes';
import { snapshotsRouter } from './boards/snapshots.routes';
import { versionsRouter } from './boards/versions.routes';
import { env } from './env';
import { errorHandler } from './errors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const app = express();
// express-rate-limit інакше кидає ValidationError, щойно побачить
// X-Forwarded-For (тунель на телефон), і рахує ліміт по адресі проксі
app.set('trust proxy', env.trustProxy);
// дефолтних 100kb снепшоту дошки замало
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    uptimeSeconds: process.uptime(),
    version,
    limits: { fileMaxBytes: env.fileMaxBytes, boardFilesMaxBytes: env.boardFilesMaxBytes },
  };
  res.json(body);
});

// куди браузеру стукати, щоб пробити NAT. Облікові дані TURN мусять дійти
// до самого браузера — інакше він до ретранслятора не підключиться; захист
// тут не в приховуванні, а в тому, що вони тимчасові (див. записку 2.6).
// Під авторизацією, щоб TURN не роздавався всьому інтернету
app.get('/api/ice-config', requireAuth, (_req, res) => {
  const iceServers: IceServerConfig[] = [{ urls: env.iceStunUrls }];
  if (env.iceTurnUrl) {
    iceServers.push({
      urls: [env.iceTurnUrl],
      username: env.iceTurnUsername,
      credential: env.iceTurnCredential,
    });
  }
  const body: IceConfigResponse = { iceServers, iceTransportPolicy: env.iceTransportPolicy };
  res.json(body);
});

// лічильники самого процесу для стенду. cpuUsage — наростаюча сума з моменту
// старту, тому стенд бере різницю між початком і кінцем прогону; памʼять
// опитує періодично й бере пік
if (env.benchMetrics) {
  app.get('/api/metrics', (_req, res) => {
    res.json({
      at: Date.now(),
      uptimeSeconds: process.uptime(),
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
      rooms: roomStats(),
    });
  });

  // стенд міряє три стратегії поспіль і мусить переставляти режим кімнат, не
  // перезапускаючи сервер. Браузеру цього не віддаємо ніколи: саме з того, що
  // режим вибирав клієнт, і виріс розʼїзд кімнати (журнал 05.10)
  app.post('/api/bench/strategy', (req, res) => {
    const { strategy } = req.body as { strategy?: unknown };
    if (!isSyncStrategy(strategy)) {
      res.status(400).json({ error: 'невідома стратегія' });
      return;
    }
    setSyncStrategyOfRooms(strategy);
    res.json({ strategy });
  });
}

app.use('/api/auth', authRouter);
app.use('/api/me', profileRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/invites', invitesRouter);
app.use('/api/link-preview', linkPreviewRouter);
app.use('/api/boards/:id/snapshot', snapshotsRouter);
app.use('/api/boards/:id/chat', chatRouter);
app.use('/api/boards/:id/seat', seatsRouter);
app.use('/api/boards/:id/versions', versionsRouter);
app.use('/api/boards/:id/images', imagesRouter);
app.use('/api/boards/:id/files', filesRouter);
// завантажені картинки — статикою, без перевірки прав: імена — uuid, не вгадати
app.use('/uploads', express.static(UPLOADS_DIR));

// спайки — тільки для розробки, в проді їх не буде на диску
if (!env.isProduction) {
  app.get('/spike/webrtc-ice-config', (_req, res) => {
    const iceServers: IceServerConfig[] = [{ urls: env.iceStunUrls }];
    if (env.iceTurnUrl) {
      iceServers.push({
        urls: [env.iceTurnUrl],
        username: env.iceTurnUsername,
        credential: env.iceTurnCredential,
      });
    }
    res.json({ iceServers, iceTransportPolicy: env.iceTransportPolicy });
  });

  app.use('/spike/webrtc', express.static(resolve(__dirname, '../../spike/webrtc')));
}

app.use(errorHandler);
