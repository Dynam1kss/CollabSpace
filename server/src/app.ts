import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { HealthResponse } from 'shared';
import { authRouter } from './auth/auth.routes';
import { boardsRouter } from './boards/boards.routes';
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
app.use(express.json());

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
