import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { HealthResponse } from 'shared';
import { authRouter } from './auth/auth.routes';
import { boardsRouter } from './boards/boards.routes';
import { chatRouter } from './boards/chat.routes';
import { imagesRouter, UPLOADS_DIR } from './boards/images.routes';
import { snapshotsRouter } from './boards/snapshots.routes';
import { env } from './env';
import { errorHandler } from './errors';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

interface SpikeIceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

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
  };
  res.json(body);
});

app.use('/api/auth', authRouter);
app.use('/api/boards', boardsRouter);
app.use('/api/boards/:id/snapshot', snapshotsRouter);
app.use('/api/boards/:id/chat', chatRouter);
app.use('/api/boards/:id/images', imagesRouter);
// завантажені картинки — статикою, без перевірки прав: імена — uuid, не вгадати
app.use('/uploads', express.static(UPLOADS_DIR));

// спайки — тільки для розробки, в проді їх не буде на диску
if (!env.isProduction) {
  app.get('/spike/webrtc-ice-config', (_req, res) => {
    const iceServers: SpikeIceServerConfig[] = [{ urls: env.iceStunUrls }];
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
