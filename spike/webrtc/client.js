// сигналізація іде через той самий сервер, що й сторінка — тому wss/ws і хост
// беремо з поточної адреси, а не хардкодимо localhost (інакше з телефону не достукатись)
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const SIGNAL_URL = `${wsProtocol}://${window.location.host}/spike/webrtc-signal`;
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const STATS_POLL_MS = 100;

const connectBtn = document.getElementById('connect-btn');
const statusEl = document.getElementById('status');
const localMeter = document.getElementById('local-meter');
const remoteMeter = document.getElementById('remote-meter');
const remoteAudio = document.getElementById('remote-audio');

let clickedAt = 0;

connectBtn.addEventListener('click', () => {
  connectBtn.disabled = true;
  clickedAt = performance.now();

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

async function connect(audioCtx) {
  // теж викликаємо лише після кліку, не при завантаженні сторінки — інакше
  // сафарі мовчки не дасть доступ до мікрофона
  const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  attachLevelMeter(audioCtx, localStream, localMeter, () => {});

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  // дві метрики, незалежні від того, коли людина насправді заговорить:
  // час до ICE connected і час до першого прийнятого RTP-пакета
  let connectedLogged = false;
  watchForFirstInboundPacket(pc);

  const ws = new WebSocket(SIGNAL_URL);
  let polite = false;
  let makingOffer = false;
  let ignoreOffer = false;

  pc.oniceconnectionstatechange = () => {
    statusEl.textContent = pc.iceConnectionState;
    console.log('ICE connection state:', pc.iceConnectionState);
    if (!connectedLogged && pc.iceConnectionState === 'connected') {
      connectedLogged = true;
      console.log(`час до ICE connected: ${Math.round(performance.now() - clickedAt)} мс`);
    }
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      logSelectedCandidateType(pc);
    }
  };

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      sendSignal(ws, { candidate });
    }
  };

  // перфектна узгодженість (perfect negotiation, за рецептом з MDN) — без неї два офери
  // одночасно від обох вкладок ламають переговори
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(ws, { description: pc.localDescription });
    } catch (err) {
      console.error('negotiationneeded', err);
    } finally {
      makingOffer = false;
    }
  };

  pc.ontrack = ({ streams: [stream] }) => {
    remoteAudio.srcObject = stream;
    remoteAudio.play().catch(() => {});
    attachLevelMeter(audioCtx, stream, remoteMeter, () => {});
  };

  // кандидат іноді прилітає раніше, ніж наш setRemoteDescription встигне відпрацювати —
  // тримаємо в черзі до появи remoteDescription
  const pendingCandidates = [];

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'welcome') {
      polite = msg.polite;
      console.log('роль у переговорах:', polite ? 'polite' : 'impolite');
      return;
    }

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

// addTrack може викликати negotiationneeded ще до відкриття сокета — чекаємо open
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
function watchForFirstInboundPacket(pc) {
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
      console.log(`час до першого вхідного RTP-пакета: ${Math.round(performance.now() - clickedAt)} мс`);
    }
  }, STATS_POLL_MS);
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
