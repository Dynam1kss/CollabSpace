import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { HealthResponse } from 'shared';
import { authRouter } from './auth/auth.routes';
import { env } from './env';
import { errorHandler } from './errors';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const app = express();
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

app.use(errorHandler);

const httpServer = createServer(app);

// ws сидить на тому ж http-сервері, окремий порт не треба
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    if (data.toString() === 'ping') {
      socket.send('pong');
    }
  });
});

httpServer.listen(env.port, () => {
  console.log(`Сервер запущено на порту ${env.port}`);
});
