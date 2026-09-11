// сигналізація іде через той самий сервер, що й сторінка — тому wss/ws і хост
// беремо з поточної адреси, а не хардкодимо localhost (інакше з телефону не достукатись)
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const SIGNAL_URL = `${wsProtocol}://${window.location.host}/spike/webrtc-signal`;
const STATS_POLL_MS = 100;

const connectBtn = document.getElementById('connect-btn');
const statusEl = document.getElementById('status');
const localMeter = document.getElementById('local-meter');
const remoteMeter = document.getElementById('remote-meter');
const remoteAudio = document.getElementById('remote-audio');

connectBtn.addEventListener('click', () => {
  connectBtn.disabled = true;

  // сафарі на iOS блокує AudioContext і <audio>.play(), якщо вони не стартували
  // прямо в обробнику жесту користувача — тому обидва запускаємо тут, синхронно,
  // а не пізніше, коли прийде асинхронний стрім
  const audioCtx = new AudioContext();
  audioCtx.resume();
  remoteAudio.play().catch(() => {});

  connect(audioCtx).catch((err) => {
    console.error('не вдалось підключитись', err);
    statusEl.textContent = 'помилка, дивись консоль';
  });
});

async function fetchIceConfig() {
  try {
    const res = await fetch('/spike/webrtc-ice-config');
    const data = await res.json();
    return { iceServers: data.iceServers, iceTransportPolicy: data.iceTransportPolicy ?? 'all' };
  } catch (err) {
    console.error('не вдалось отримати ice-конфіг із сервера, fallback на публічний STUN', err);
    return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], iceTransportPolicy: 'all' };
  }
}

// адреси серверів і транспортна політика потрібні для діагностики, а
// username/credential — секрети TURN, у консоль (і потім на скріншот у
// записку) підуть тільки замасковані
function maskIceServersForLog(iceServers) {
  return iceServers.map((server) => ({
    ...server,
    ...(server.username !== undefined && { username: '***' }),
    ...(server.credential !== undefined && { credential: '***' }),
  }));
}

async function connect(audioCtx) {
  const { iceServers, iceTransportPolicy } = await fetchIceConfig();
  console.log(
    'ICE-конфігурація:',
    JSON.stringify(maskIceServersForLog(iceServers)),
    '| transportPolicy:',
    iceTransportPolicy,
  );

  // теж викликаємо лише після кліку, не при завантаженні сторінки — інакше
  // сафарі мовчки не дасть доступ до мікрофона
  const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  attachLevelMeter(audioCtx, localStream, localMeter, () => {});

  const ws = new WebSocket(SIGNAL_URL);
  let polite = false;
  let pc = null;
  let pendingCandidates = [];
  let makingOffer = false;
  let ignoreOffer = false;
  let t0 = 0;
  let connectedLogged = false;
  let statsPollTimer = null;

  // перестворює peer connection з нуля — і для першого підключення, і після
  // того, як співрозмовник вийшов: стара RTCPeerConnection з чужими описами
  // й кандидатами непридатна для нового раунду переговорів
  function setupPeerConnection() {
    if (statsPollTimer) {
      clearInterval(statsPollTimer);
      statsPollTimer = null;
    }
    if (pc) {
      pc.close();
    }

    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
    pendingCandidates = [];
    makingOffer = false;
    ignoreOffer = false;
    connectedLogged = false;

    pc.oniceconnectionstatechange = () => {
      statusEl.textContent = pc.iceConnectionState;
      console.log('ICE connection state:', pc.iceConnectionState);
      if (!connectedLogged && t0 && pc.iceConnectionState === 'connected') {
        connectedLogged = true;
        console.log(`час до ICE connected: ${Math.round(performance.now() - t0)} мс`);
      }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        logSelectedCandidateType(pc);
      }
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        logFailureSummary(pc, pc.iceConnectionState);
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log(`локальний кандидат: ${candidate.type}`);
        sendSignal(ws, { candidate });
      }
    };

    pc.ontrack = ({ streams: [stream] }) => {
      remoteAudio.srcObject = stream;
      remoteAudio.play().catch(() => {});
      attachLevelMeter(audioCtx, stream, remoteMeter, () => {});
    };
  }

  async function makeOffer() {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(ws, { description: pc.localDescription });
    } catch (err) {
      console.error('не вдалось створити offer', err);
    } finally {
      makingOffer = false;
    }
  }

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'error') {
      console.error(`сервер: ${msg.code} — ${msg.message}`);
      statusEl.textContent = msg.message;
      ws.close();
      return;
    }

    if (msg.type === 'peer-left') {
      // співрозмовник вийшов — стара RTCPeerConnection лишається з мертвими
      // ICE-кандидатами й описом; перестворюємо і чекаємо на новий room-ready
      console.log('співрозмовник вийшов, перестворюю з’єднання і чекаю на room-ready');
      statusEl.textContent = 'співрозмовник вийшов, очікую...';
      remoteAudio.srcObject = null;
      remoteMeter.style.width = '0%';
      setupPeerConnection();
      return;
    }

    if (msg.type === 'room-ready') {
      polite = msg.polite;
      console.log('роль у переговорах:', polite ? 'polite' : 'impolite');
      // t0 — момент, коли в кімнаті стало двоє (вперше або знову, після
      // повернення), а не клік по кнопці: інакше в метрику потрапляє час,
      // поки людина йде до другого пристрою
      t0 = performance.now();
      if (!pc) {
        setupPeerConnection();
      }
      statsPollTimer = watchForFirstInboundPacket(pc, t0);
      if (!polite) {
        await makeOffer();
      }
      return;
    }

    if (!pc) return;

    const { description, candidate } = msg;
    try {
      if (description) {
        const offerCollision = description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;

        await pc.setRemoteDescription(description);
        while (pendingCandidates.length > 0) {
          await pc.addIceCandidate(pendingCandidates.shift());
        }
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          sendSignal(ws, { description: pc.localDescription });
        }
      } else if (candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          pendingCandidates.push(candidate);
        }
      }
    } catch (err) {
      if (!ignoreOffer) console.error('обробка сигналу', err);
    }
  });
}

// про всяк випадок чекаємо відкриття сокета, а не тільки покладаємось на те,
// що offer/candidate завжди йдуть вже після welcome
function sendSignal(ws, msg) {
  const payload = JSON.stringify(msg);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(payload);
  } else {
    ws.addEventListener('open', () => ws.send(payload), { once: true });
  }
}

function attachLevelMeter(audioCtx, stream, meterEl, onLevel) {
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    meterEl.style.width = `${Math.min(100, (avg / 128) * 100)}%`;
    onLevel(avg);
    requestAnimationFrame(tick);
  }
  tick();
}

// опитуємо getStats, поки inbound-rtp не покаже перший прийнятий пакет —
// на відміну від рівня звуку, це не залежить від того, коли співрозмовник заговорить
function watchForFirstInboundPacket(pc, t0) {
  const timer = setInterval(async () => {
    const stats = await pc.getStats();
    let found = false;
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.packetsReceived > 0) {
        found = true;
      }
    });
    if (found) {
      clearInterval(timer);
      console.log(`час до першого вхідного RTP-пакета: ${Math.round(performance.now() - t0)} мс`);
    }
  }, STATS_POLL_MS);
  return timer;
}

async function logSelectedCandidateType(pc) {
  const stats = await pc.getStats();
  let pair;
  stats.forEach((report) => {
    if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
      pair = report;
    }
  });
  if (!pair) return;

  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  console.log(`тип зʼєднання: local=${local?.candidateType} remote=${remote?.candidateType}`);
}

// для дослідження мереж, де STUN не вистачає (CGNAT, симетричний NAT):
// скільки кандидатів якого типу зібрано з обох боків і яка пара обиралась
async function logFailureSummary(pc, reason) {
  const stats = await pc.getStats();
  const localCounts = {};
  const remoteCounts = {};
  let bestPair = null;
  let anyPair = null;

  stats.forEach((report) => {
    if (report.type === 'local-candidate') {
      localCounts[report.candidateType] = (localCounts[report.candidateType] ?? 0) + 1;
    } else if (report.type === 'remote-candidate') {
      remoteCounts[report.candidateType] = (remoteCounts[report.candidateType] ?? 0) + 1;
    } else if (report.type === 'candidate-pair') {
      anyPair = report;
      if (report.nominated || report.state === 'succeeded') {
        bestPair = report;
      }
    }
  });

  // якщо жодна пара не піднялась (типово при CGNAT/симетричному NAT), краще
  // показати останню спробувану пару, ніж просто "жодної" — саме це й досліджуємо
  const pair = bestPair ?? anyPair;
  let pairInfo = 'жодної';
  if (pair) {
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    pairInfo = `${pair.state}, local=${local?.candidateType ?? '?'} remote=${remote?.candidateType ?? '?'}`;
  }

  console.log(`--- зведення ICE після переходу в "${reason}" ---`);
  console.log('локальні кандидати за типом:', localCounts);
  console.log('віддалені кандидати за типом:', remoteCounts);
  console.log('ICE gathering state:', pc.iceGatheringState);
  console.log('обрана пара:', pairInfo);
}
