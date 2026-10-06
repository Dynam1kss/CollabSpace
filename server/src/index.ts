import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { app } from './app';
import { startOrphanSweep } from './boards/files.sweep';
import { tryUpgradeBoardRoom } from './boards/board-rooms';
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

// сигналізація для spike/webrtc/ — кімната одна, максимум двоє. учасник, що
// підключився першим, не робить offer, поки сам у кімнаті — чекає "room-ready".
// раніше перший одразу слав offer, сервер його кешував і віддавав новому
// клієнту; але той на той момент уже встиг зробити СВІЙ offer (onnegotiationneeded
// спрацьовує від addTrack незалежно від того, чи є з ким говорити), і прийом
// чужого offer вимагав неявного rollback власного — саме тут губилось з'єднання
// між Safari (перший) і Chrome (другий). Без гонитви двох офферів rollback не потрібен
const spikeSignalWss = new WebSocketServer({ noServer: true });
const spikeClients = new Set<WebSocket>();
// розрив мобільної мережі чи згортання вкладки не завжди шле close — рахуємо
// пропущені pong і рвемо зʼєднання самі, інакше мертвий сокет блокує кімнату
const spikeMissedPings = new WeakMap<WebSocket, number>();
const SPIKE_KEEPALIVE_MS = 10_000;

// прибирає сокет із кімнати і, якщо саме через це кімната з двох стала одна,
// повідомляє того, хто лишився — інакше в нього висить мертве з'єднання, і
// повторний вхід учасника, що вийшов, вже нічого не заводить. idempotent:
// delete() на вже прибраному сокеті — no-op, тому close+error для того самого
// сокета не надішлють "peer-left" двічі
function handleSpikeLeave(socket: WebSocket) {
  const sizeBefore = spikeClients.size;
  if (!spikeClients.delete(socket)) return;
  const sizeAfter = spikeClients.size;

  console.log(`[spike] відключення, лишилось у кімнаті: ${sizeAfter}`);

  if (sizeBefore === 2 && sizeAfter === 1) {
    for (const client of spikeClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'peer-left' }));
      }
    }
  }
}

spikeSignalWss.on('connection', (socket) => {
  if (spikeClients.size >= 2) {
    console.log('[spike] кімната зайнята, відмовляю третьому');
    socket.send(
      JSON.stringify({
        type: 'error',
        code: 'ROOM_FULL',
        message: 'У кімнаті вже двоє — спробуй пізніше',
      }),
    );
    socket.close(4000, 'room full');
    return;
  }

  spikeClients.add(socket);
  spikeMissedPings.set(socket, 0);
  socket.on('pong', () => spikeMissedPings.set(socket, 0));
  console.log(`[spike] підключення, у кімнаті: ${spikeClients.size}`);

  if (spikeClients.size === 2) {
    // роль вирішуємо саме тут, а не при підключенні — інакше після
    // "peer-left" учасник, що лишився, міг би застрягти зі старою роллю
    // і обидва опинились би polite (ніхто не робить offer)
    console.log('[spike] у кімнаті двоє — шлю room-ready обом');
    let polite = false;
    for (const client of spikeClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'room-ready', polite }));
      }
      polite = true;
    }
  }

  socket.on('message', (data) => {
    const raw = data.toString();
    for (const client of spikeClients) {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(raw);
      }
    }
  });

  socket.on('close', () => handleSpikeLeave(socket));
  socket.on('error', (err) => {
    console.log('[spike] помилка сокета:', err.message);
    handleSpikeLeave(socket);
  });
});

// раз на SPIKE_KEEPALIVE_MS пінгуємо кожного; два пропущені pong поспіль
// (тобто нуль відповідей за два інтервали) — вважаємо мертвим і рвемо
// зʼєднання самі. terminate() сам генерує 'close', тому додатково
// handleSpikeLeave тут викликати не треба — той самий шлях, що й для явного виходу
setInterval(() => {
  for (const socket of spikeClients) {
    const missed = (spikeMissedPings.get(socket) ?? 0) + 1;
    if (missed >= 2) {
      console.log('[spike] клієнт не відповів на ping два інтервали поспіль — відключаю');
      socket.terminate();
      continue;
    }
    spikeMissedPings.set(socket, missed);
    socket.ping();
  }
}, SPIKE_KEEPALIVE_MS);

httpServer.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');

  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/spike/webrtc-signal') {
    spikeSignalWss.handleUpgrade(req, socket, head, (ws) => spikeSignalWss.emit('connection', ws, req));
  } else if (!tryUpgradeBoardRoom(req, socket, head, pathname)) {
    socket.destroy();
  }
});

// прибирач файлів-сиріт: файли, на які вже добу ніхто не посилається
startOrphanSweep();

// 0.0.0.0, а не тільки localhost — щоб спайк був доступний з інших пристроїв у мережі
httpServer.listen(env.port, '0.0.0.0', () => {
  console.log(`Сервер запущено на порту ${env.port}`);
});
