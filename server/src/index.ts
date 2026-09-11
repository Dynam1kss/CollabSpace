import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { app } from './app';
import { env } from './env';

const httpServer = createServer(app);

// noServer: за { server, path } кожен wss сам абортить чужий шлях 400-кою,
// тому кілька wss на одному http-сервері треба роутити вручну за pathname
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    if (data.toString() === 'ping') {
      socket.send('pong');
    }
  });
});

// сигналізація для spike/webrtc/ — кімната одна, просто ретранслюємо повідомлення
// іншим підключеним клієнтам. приберемо разом зі спайком, коли перепишемо начисто
const spikeSignalWss = new WebSocketServer({ noServer: true });
const spikeClients = new Set<WebSocket>();
// перший оффер часто відправляється до того, як другий клієнт встигне підключитись —
// без кешу він губиться назавжди, бо broadcast розсилає лише тим, хто вже в кімнаті
let lastSpikeOffer: string | null = null;

spikeSignalWss.on('connection', (socket) => {
  // хто підключився другим — polite (перший не поступається при конфлікті офферів)
  socket.send(JSON.stringify({ type: 'welcome', polite: spikeClients.size > 0 }));
  if (lastSpikeOffer) {
    socket.send(lastSpikeOffer);
  }
  spikeClients.add(socket);

  socket.on('message', (data) => {
    const raw = data.toString();
    try {
      const parsed = JSON.parse(raw);
      if (parsed.description?.type === 'offer') {
        lastSpikeOffer = raw;
      }
    } catch {
      // не наше повідомлення формату — просто ретранслюємо як є
    }

    for (const client of spikeClients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  });

  socket.on('close', () => spikeClients.delete(socket));
});

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');

  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/spike/webrtc-signal') {
    spikeSignalWss.handleUpgrade(req, socket, head, (ws) => spikeSignalWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// 0.0.0.0, а не тільки localhost — щоб спайк був доступний з інших пристроїв у мережі
httpServer.listen(env.port, '0.0.0.0', () => {
  console.log(`Сервер запущено на порту ${env.port}`);
});
