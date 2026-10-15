// кампанія фінального прогону для розділу 4: піднімає застосунок, ганяє
// bench/load.mjs по клітинках плану, збирає сирі json, зведений csv і
// діагностику (cpu машини, cpu сервера, затримка event loop). запускається
// один раз і доводить справу до кінця без нагляду; після падіння
// перезапуск продовжує з того місця, де спинився (progress.json)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const DATE = process.env.CAMPAIGN_DATE ?? new Date().toISOString().slice(0, 10);
// звіряльний прогін пишемо в окрему теку: дані final-* цитує записка, і
// перезаписати їх не можна
const OUT = path.join(here, 'results', process.env.CAMPAIGN_OUT || `final-${DATE}`);
const RUNS = path.join(OUT, 'runs');
const LOG = path.join(OUT, 'campaign.log');
const PROGRESS = path.join(OUT, 'progress.json');
const PIDS = path.join(OUT, 'pids.json');

const SERVER_PORT = 3000;
const CLIENT_PORT = 5173;
const BASE = `http://localhost:${CLIENT_PORT}`;
const DIRECT = `http://localhost:${SERVER_PORT}`;
const CONTAINERS = ['master-project-postgres-1', 'master-project-redis-1', 'master-project-maildev-1'];
const PLAYWRIGHT_MARK = 'ms-playwright';

// скільки чекати на один прогін, хвилини. межа щедра: на 50 вкладках лише
// вихід у live буває кілька хвилин, а дренаж за планом триває до 5
const TIMEOUT_MIN = { 5: 12, 10: 15, 25: 30, 50: 55 };
// первинна оцінка тривалості; далі уточнюється по вже зміряних прогонах
const ETA_MIN = { 5: 3, 10: 4, 25: 8, 50: 16 };
const COOLDOWN_MS = 20_000;
// необовʼязкові повтори batched беремо лише якщо кампанія не затяглась
const OPTIONAL_AFTER_H = 10;

const plan = [];
plan.push({ id: 's1-aoi-25', stage: 1, strategy: 'aoi', n: 25, repeat: 1, variant: 'diag' });
plan.push({ id: 's1-aoi-50', stage: 1, strategy: 'aoi', n: 50, repeat: 1, variant: 'diag' });
plan.push({ id: 's1-batched-25', stage: 1, strategy: 'batched', n: 25, repeat: 1, variant: 'diag' });
// той самий сервер під 50 клієнтами, але кожен процес генератора веде лише 25:
// якщо числа підскочать — вузьке місце було в генераторі, а не в сервері
plan.push({
  id: 's1-aoi-50-split',
  stage: 1,
  strategy: 'aoi',
  n: 50,
  repeat: 1,
  variant: 'split2x25',
  split: { procs: 2, nPerProc: 25 },
});
for (const n of [5, 10, 25, 50])
  for (const strategy of ['per-event', 'batched', 'aoi'])
    plan.push({ id: `s2-${strategy}-${n}`, stage: 2, strategy, n, repeat: 1, variant: 'full' });
for (const repeat of [2, 3])
  for (const n of [5, 10, 25, 50])
    plan.push({ id: `s3-aoi-${n}-r${repeat}`, stage: 3, strategy: 'aoi', n, repeat, variant: 'repeat' });
for (const repeat of [2, 3])
  for (const n of [5, 10])
    plan.push({
      id: `s3-batched-${n}-r${repeat}`,
      stage: 3,
      strategy: 'batched',
      n,
      repeat,
      variant: 'repeat',
      optional: true,
    });

// дозволяє прогнати лише окремі клітинки плану — для перевірки самого стенду
// і для доміру руками після кампанії
const only = process.env.CAMPAIGN_ONLY?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const plannedRuns = only ? plan.filter((p) => only.includes(p.id)) : plan;

fs.mkdirSync(RUNS, { recursive: true });

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(line) {
  const s = `${ts()}  ${line}\n`;
  fs.appendFileSync(LOG, s);
  process.stdout.write(s);
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// синхронна пауза: timeout.exe без консолі не працює, а тут треба саме блокувати
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const minutes = (ms) => Math.round(ms / 600) / 100;

const ps = (script) =>
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });

async function get(url, ms = 5000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1500);
    s.on('connect', () => done(true));
    s.on('timeout', () => done(false));
    s.on('error', () => done(false));
  });

async function waitPortFree(port, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!(await portBusy(port))) return true;
    await sleep(1000);
  }
  return false;
}

function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
}

// pid із попереднього запуску кампанії може вже належати чужому процесу —
// перед taskkill звіряємо командний рядок
function killTreeIfOurs(pid, needle) {
  if (!pid) return;
  const r = ps(`(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`);
  const cmd = (r.stdout ?? '').trim();
  if (cmd && (cmd.includes(needle) || cmd.includes('keep-awake'))) killTree(pid);
}

// dev-сервер і preview, підняті руками до кампанії. викликати ЛИШЕ на старті:
// наші власні процеси теж підходять під цей фільтр. tsx watch тут головний
// клопіт — він перезапускає свій процес і відбирає порт назад посеред прогону
function stopStrayAppProcesses() {
  const like = ['*watch*', '*preview*', '*vite*', '*index.ts*']
    .map((x) => `$_.CommandLine -like '${x}'`)
    .join(' -or ');
  const r = ps(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -like '*Master-project*' -and (${like}) } | ForEach-Object { $_.ProcessId }`,
  );
  const pids = (r.stdout ?? '')
    .split(/[\r\n]+/)
    .map(Number)
    .filter(Boolean);
  for (const pid of pids) killTree(pid);
  if (pids.length) log(`зупинено процеси застосунку, що працювали до кампанії: ${pids.join(', ')}`);
  return pids;
}

// порт тримає чужий процес із цього ж репозиторію (наприклад dev-сервер,
// запущений руками) — його треба прибрати, інакше наш не стане на порт
function killPortOwner(port) {
  const r = ps(
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.OwningProcess); if ($p.CommandLine -like '*Master-project*') { $p.ProcessId } }`,
  );
  for (const line of (r.stdout ?? '').split(/[\r\n]+/)) {
    const pid = Number(line.trim());
    if (pid) {
      log(`порт ${port} тримав процес ${pid} із цього репозиторію — зупиняю`);
      killTree(pid);
    }
  }
}

// лише браузери стенду: фільтр по шляху в кеші playwright, щоб не зачепити
// звичайний chrome користувача
function killStrayChromium() {
  const r = ps(
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.ExecutablePath -like '*${PLAYWRIGHT_MARK}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; 'killed ' + $_.ProcessId }`,
  );
  const killed = (r.stdout ?? '').trim();
  if (killed) log(`прибрано залишки chromium: ${killed.split(/\r?\n/).length}`);
}

function countStrayChromium() {
  const r = ps(
    `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.ExecutablePath -like '*${PLAYWRIGHT_MARK}*' } | Measure-Object).Count`,
  );
  return Number((r.stdout ?? '').trim()) || 0;
}

function dockerNames() {
  const r = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout ?? '').split(/\r?\n/).filter(Boolean);
}

function ensureContainers() {
  const up = dockerNames();
  const missing = CONTAINERS.filter((c) => !up.includes(c));
  if (!missing.length) return true;
  log(`контейнери не підняті (${missing.join(', ')}) — docker compose up -d`);
  const r = spawnSync('docker', ['compose', 'up', '-d'], { cwd: repo, encoding: 'utf8', windowsHide: true });
  fs.appendFileSync(path.join(OUT, 'docker.log'), `${ts()}\n${r.stdout ?? ''}${r.stderr ?? ''}\n`);
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync('docker', ['exec', CONTAINERS[0], 'pg_isready', '-q'], { windowsHide: true });
    if (ready.status === 0 && CONTAINERS.every((c) => dockerNames().includes(c))) return true;
    sleepSync(2000);
  }
  log('УВАГА: контейнери так і не піднялись');
  return false;
}

let app = { server: null, vite: null };
let keepAwake = null;

const savePids = () =>
  writeJson(PIDS, {
    server: app.server?.pid ?? null,
    vite: app.vite?.pid ?? null,
    keepAwake: keepAwake?.pid ?? null,
    orchestrator: process.pid,
  });

function openLog(name) {
  return fs.openSync(path.join(OUT, name), 'a');
}

async function startApp() {
  for (const port of [SERVER_PORT, CLIENT_PORT]) {
    if (await portBusy(port)) killPortOwner(port);
    await waitPortFree(port, 20_000);
  }
  const sfd = openLog('server.log');
  const vfd = openLog('vite.log');
  fs.appendFileSync(path.join(OUT, 'server.log'), `\n---- старт ${ts()} ----\n`);
  // без tsx watch: будь-який дотик до файлу перезапустив би сервер посеред прогону
  app.server = spawn(process.execPath, [path.join(repo, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: path.join(repo, 'server'),
    // NODE_ENV=test знімає ліміт реєстрацій: кампанія бере понад 600 акаунтів
    env: { ...process.env, NODE_ENV: 'test', BENCH_METRICS: '1' },
    stdio: ['ignore', sfd, sfd],
    windowsHide: true,
  });
  app.vite = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js')], {
    cwd: path.join(repo, 'client'),
    env: { ...process.env },
    stdio: ['ignore', vfd, vfd],
    windowsHide: true,
  });
  savePids();
  const until = Date.now() + 150_000;
  while (Date.now() < until) {
    try {
      const h = await get(`${DIRECT}/api/health`);
      await get(`${DIRECT}/api/metrics`);
      const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(5000) });
      if (h.status === 'ok' && r.ok) {
        log(`застосунок піднято: сервер pid ${app.server.pid}, vite pid ${app.vite.pid}`);
        return true;
      }
    } catch {
      // ще піднімається
    }
    await sleep(2000);
  }
  log('УВАГА: застосунок не піднявся за 150с');
  return false;
}

async function stopApp() {
  killTree(app.server?.pid);
  killTree(app.vite?.pid);
  app = { server: null, vite: null };
  await waitPortFree(SERVER_PORT);
  await waitPortFree(CLIENT_PORT);
  savePids();
}

async function appHealthy() {
  try {
    await get(`${DIRECT}/api/health`, 8000);
    await get(`${DIRECT}/api/metrics`, 8000);
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function restartApp(why) {
  log(`перезапуск застосунку: ${why}`);
  await stopApp();
  killStrayChromium();
  ensureContainers();
  return startApp();
}

function startKeepAwake() {
  const fd = openLog('keep-awake.log');
  keepAwake = spawn(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(here, 'keep-awake.ps1'),
    ],
    { stdio: ['ignore', fd, fd], windowsHide: true },
  );
  savePids();
  log(`сон вимкнено на час кампанії, pid ${keepAwake.pid}`);
}

const cpuBusy = () => {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { busy, total };
};

// опитувач раз на секунду: cpu машини з os.cpus (нічого не породжує, тож і
// вимір не псує), cpu й памʼять серверного процесу та затримка event loop
// вікнами по секунді (?reset=1 скидає гістограму після читання)
function startSampler(file) {
  const samples = [];
  let prevCpu = cpuBusy();
  let prevSrv = null;
  let prevSelf = process.cpuUsage();
  let prevAt = Date.now();
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const at = Date.now();
      const dtMs = at - prevAt;
      if (dtMs < 200) return;
      const nowCpu = cpuBusy();
      const dBusy = nowCpu.busy - prevCpu.busy;
      const dTotal = nowCpu.total - prevCpu.total;
      const cores = os.cpus().length;
      const machineCores = dTotal > 0 ? (dBusy / dTotal) * cores : null;
      const self = process.cpuUsage();
      const selfCores = (self.user - prevSelf.user + (self.system - prevSelf.system)) / 1000 / dtMs;
      let srv = null;
      try {
        srv = await get(`${DIRECT}/api/metrics?reset=1`, 4000);
      } catch {
        srv = null;
      }
      let serverCores = null;
      if (srv && prevSrv) {
        const d = srv.cpu.user - prevSrv.cpu.user + (srv.cpu.system - prevSrv.cpu.system);
        serverCores = d / 1000 / Math.max(1, srv.at - prevSrv.at);
      }
      const rec = {
        t: at,
        machineCores: machineCores === null ? null : Math.round(machineCores * 100) / 100,
        serverCores: serverCores === null ? null : Math.round(serverCores * 1000) / 1000,
        selfCores: Math.round(selfCores * 1000) / 1000,
        freeMb: Math.round(os.freemem() / 1048576),
        rssMb: srv ? Math.round(srv.memory.rss / 1048576) : null,
        heapMb: srv ? Math.round(srv.memory.heapUsed / 1048576) : null,
        loop: srv?.eventLoopDelayMs ?? null,
        rooms: srv?.rooms ?? null,
        uptime: srv ? Math.round(srv.uptimeSeconds) : null,
      };
      samples.push(rec);
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
      prevCpu = nowCpu;
      prevSelf = self;
      prevAt = at;
      if (srv) prevSrv = srv;
    } finally {
      busy = false;
    }
  }, 1000);
  return { samples, stop: () => clearInterval(timer) };
}

const num = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
const pctl = (xs, p) => {
  const s = num(xs).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null;
};
const mean = (xs) => {
  const s = num(xs);
  return s.length ? Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 1000) / 1000 : null;
};
const maxOf = (xs) => {
  const s = num(xs);
  return s.length ? Math.max(...s) : null;
};
const minOf = (xs) => {
  const s = num(xs);
  return s.length ? Math.min(...s) : null;
};

// зводимо опитувач у кілька чисел. окремо по всьому прогону й окремо по
// вікну активності з дренажем: решта часу — це реєстрації й розсаджування
// вкладок, вони середнє лише розмивають
function sampleStats(samples, window) {
  const inWindow = window ? samples.filter((s) => s.t >= window.from && s.t <= window.to) : [];
  const of = (rows) => ({
    count: rows.length,
    machineCoresMean: mean(rows.map((r) => r.machineCores)),
    machineCoresP95: pctl(
      rows.map((r) => r.machineCores),
      0.95,
    ),
    machineCoresMax: maxOf(rows.map((r) => r.machineCores)),
    serverCoresMean: mean(rows.map((r) => r.serverCores)),
    serverCoresMax: maxOf(rows.map((r) => r.serverCores)),
    // генератор = машина мінус сервер мінус сам опитувач; решта машини в спокої
    generatorCoresMean: mean(
      rows.map((r) =>
        r.machineCores === null ? null : r.machineCores - (r.serverCores ?? 0) - (r.selfCores ?? 0),
      ),
    ),
    generatorCoresMax: maxOf(
      rows.map((r) =>
        r.machineCores === null ? null : r.machineCores - (r.serverCores ?? 0) - (r.selfCores ?? 0),
      ),
    ),
    loopP50Mean: mean(rows.map((r) => r.loop?.p50)),
    loopP95Max: maxOf(rows.map((r) => r.loop?.p95)),
    loopP99Max: maxOf(rows.map((r) => r.loop?.p99)),
    loopMaxMax: maxOf(rows.map((r) => r.loop?.max)),
    rssMaxMb: maxOf(rows.map((r) => r.rssMb)),
    heapMaxMb: maxOf(rows.map((r) => r.heapMb)),
    freeMinMb: minOf(rows.map((r) => r.freeMb)),
    socketsMax: maxOf(rows.map((r) => r.rooms?.sockets)),
    boardRoomsMax: maxOf(rows.map((r) => r.rooms?.boardRooms)),
    cellRoomsMax: maxOf(rows.map((r) => r.rooms?.cellRooms)),
    cellSubsMax: maxOf(rows.map((r) => r.rooms?.cellSubscriptions)),
  });
  return { whole: of(samples), activity: window ? of(inWindow) : null };
}

// вікно активності вираховуємо з мітками часу по рядках дочірнього процесу:
// після «засіяно N/N» починаються жести, а підсумковий рядок «жестів …»
// друкується вже після дренажу
function activityWindow(marks) {
  const seeded = marks.filter((m) => m.kind === 'seeded').pop();
  const done = marks.filter((m) => m.kind === 'summary').pop();
  if (!seeded || !done || done.t <= seeded.t) return null;
  return { from: seeded.t, to: done.t };
}

function spawnChild(run, dir, n, logFile) {
  const marks = [];
  const out = fs.createWriteStream(logFile, { flags: 'a' });
  const child = spawn(process.execPath, [path.join(here, 'load.mjs')], {
    cwd: here,
    env: {
      ...process.env,
      BENCH_BASE: BASE,
      BENCH_N: String(n),
      BENCH_STRATEGIES: run.strategy,
      BENCH_RESULTS_DIR: dir,
      // рядки прогресу по пачках вкладок — із них же беремо межі активності
      BENCH_DEBUG: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let tail = '';
  const onData = (buf) => {
    tail += buf.toString();
    const lines = tail.split(/\r?\n/);
    tail = lines.pop() ?? '';
    for (const line of lines) {
      const t = Date.now();
      out.write(`${new Date(t).toISOString()}  ${line}\n`);
      if (/^\s*засіяно\s/.test(line)) marks.push({ kind: 'seeded', t, line });
      else if (/^\s*жестів\s/.test(line)) marks.push({ kind: 'summary', t, line });
      else if (/^\s*(відкрито|наведено)\s/.test(line)) marks.push({ kind: 'phase', t, line });
      else if (/УВАГА/.test(line)) marks.push({ kind: 'warn', t, line });
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const done = new Promise((resolve) => {
    child.on('close', (code) => {
      if (tail) out.write(`${new Date().toISOString()}  ${tail}\n`);
      out.end();
      resolve(code);
    });
  });
  return { child, marks, done };
}

function rowsOf(dir) {
  const data = readJson(path.join(dir, 'load.json'), null);
  return Array.isArray(data?.rows) ? data.rows : [];
}

async function executeRun(run, attempt) {
  const dir = path.join(RUNS, run.id);
  fs.mkdirSync(dir, { recursive: true });

  const sampler = startSampler(path.join(dir, `samples-attempt${attempt}.ndjson`));
  const startedAt = Date.now();
  const timeoutMs = (TIMEOUT_MIN[run.n] ?? 55) * 60_000 * (run.split ? 1.2 : 1);
  const parts = run.split
    ? Array.from({ length: run.split.procs }, (_, i) => ({
        dir: path.join(dir, `p${i + 1}`),
        n: run.split.nPerProc,
      }))
    : [{ dir, n: run.n }];
  for (const p of parts) {
    fs.mkdirSync(p.dir, { recursive: true });
    // попередня спроба могла лишити частковий результат — міряємо з чистого
    fs.rmSync(path.join(p.dir, 'load.json'), { force: true });
  }

  const children = parts.map((p, i) =>
    spawnChild(
      run,
      p.dir,
      p.n,
      path.join(dir, `child-attempt${attempt}${run.split ? `-p${i + 1}` : ''}.log`),
    ),
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log(`${run.id}: вийшов час (${Math.round(timeoutMs / 60000)} хв) — знімаю процес`);
    for (const c of children) killTree(c.child.pid);
  }, timeoutMs);

  const codes = await Promise.all(children.map((c) => c.done));
  clearTimeout(timer);
  sampler.stop();
  const endedAt = Date.now();
  killStrayChromium();

  const marks = children.flatMap((c) => c.marks);
  const window = activityWindow(marks);
  const stats = sampleStats(sampler.samples, window);
  const produced = parts.flatMap((p, i) =>
    rowsOf(p.dir).map((row) => ({ ...row, proc: run.split ? i + 1 : 1 })),
  );
  const info = {
    id: run.id,
    stage: run.stage,
    strategy: run.strategy,
    n: run.n,
    repeat: run.repeat,
    variant: run.variant,
    attempt,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    exitCodes: codes,
    timedOut,
    clientsPerProcess: run.split ? run.split.nPerProc : run.n,
    processes: parts.length,
    activityWindow: window && {
      from: new Date(window.from).toISOString(),
      to: new Date(window.to).toISOString(),
    },
    warnings: marks.filter((m) => m.kind === 'warn').map((m) => m.line.trim()),
    stats,
    rows: produced,
  };
  writeJson(path.join(dir, `run-attempt${attempt}.json`), info);

  if (timedOut) throw new Error('вийшов час прогону');
  if (codes.some((c) => c !== 0)) throw new Error(`load.mjs вийшов з кодом ${codes.join(',')}`);
  if (produced.length !== parts.length)
    throw new Error(`очікував ${parts.length} рядків, отримав ${produced.length}`);
  writeJson(path.join(dir, 'run.json'), info);
  return info;
}

const csvHead = [
  'runId',
  'stage',
  'strategy',
  'n',
  'repeat',
  'variant',
  'proc',
  'clientsPerProcess',
  'regions',
  'objects',
  'activityMs',
  'gestures',
  'perClientGestures',
  'inPerClient_frames',
  'inPerClient_bytes',
  'inPerGesture_frames',
  'inPerGesture_bytes',
  'outPerClient_frames',
  'outPerClient_bytes',
  'latency_p50',
  'latency_p95',
  'latency_p99',
  'latency_count',
  'latencyFull_p50',
  'latencyFull_p95',
  'convergenceMs',
  'converged',
  'drainMs',
  'disagree',
  'dbMismatch',
  'idleClients',
  'server_cpuPercentOfCore',
  'server_rssPeakMb',
  'server_heapPeakMb',
  'act_machineCoresMean',
  'act_machineCoresMax',
  'act_serverCoresMean',
  'act_serverCoresMax',
  'act_generatorCoresMean',
  'act_generatorCoresMax',
  'act_loopP50Mean',
  'act_loopP95Max',
  'act_loopP99Max',
  'act_loopMaxMax',
  'act_socketsMax',
  'act_cellSubsMax',
  'act_freeMinMb',
  'durationMs',
  'status',
];

const csvValue = (v) => (v === null || v === undefined ? '' : String(v));

function csvRows(progress) {
  const lines = [csvHead.join(',')];
  for (const run of plannedRuns) {
    const st = progress.runs[run.id];
    if (!st) continue;
    const info = readJson(path.join(RUNS, run.id, 'run.json'), null);
    if (!info) {
      lines.push(
        csvHead
          .map((h) =>
            csvValue(
              {
                runId: run.id,
                stage: run.stage,
                strategy: run.strategy,
                n: run.n,
                repeat: run.repeat,
                variant: run.variant,
                status: st.status,
              }[h] ?? null,
            ),
          )
          .join(','),
      );
      continue;
    }
    const a = info.stats.activity ?? info.stats.whole;
    for (const r of info.rows) {
      const map = {
        runId: info.id,
        stage: info.stage,
        strategy: r.strategy,
        n: r.n,
        repeat: info.repeat,
        variant: info.variant,
        proc: r.proc,
        clientsPerProcess: info.clientsPerProcess,
        regions: r.regions,
        objects: r.objects,
        activityMs: r.activityMs,
        gestures: r.gestures,
        perClientGestures: r.perClientGestures,
        inPerClient_frames: r.traffic.inPerClient.n,
        inPerClient_bytes: r.traffic.inPerClient.bytes,
        inPerGesture_frames: r.traffic.inPerClientPerGesture.n,
        inPerGesture_bytes: r.traffic.inPerClientPerGesture.bytes,
        outPerClient_frames: r.traffic.outPerClient.n,
        outPerClient_bytes: r.traffic.outPerClient.bytes,
        latency_p50: r.latencyMs?.p50 ?? null,
        latency_p95: r.latencyMs?.p95 ?? null,
        latency_p99: r.latencyMs?.p99 ?? null,
        latency_count: r.latencyMs?.count ?? null,
        latencyFull_p50: r.latencyFullMs?.p50 ?? null,
        latencyFull_p95: r.latencyFullMs?.p95 ?? null,
        convergenceMs: r.convergenceMs,
        converged: r.converged,
        drainMs: r.drainMs,
        disagree: r.agreement.disagree,
        dbMismatch: r.agreement.dbMismatch,
        idleClients: r.ownChanges.idleClients,
        server_cpuPercentOfCore: r.server.cpuPercentOfCore,
        server_rssPeakMb: r.server.rssPeakMb,
        server_heapPeakMb: r.server.heapPeakMb,
        act_machineCoresMean: a.machineCoresMean,
        act_machineCoresMax: a.machineCoresMax,
        act_serverCoresMean: a.serverCoresMean,
        act_serverCoresMax: a.serverCoresMax,
        act_generatorCoresMean: a.generatorCoresMean,
        act_generatorCoresMax: a.generatorCoresMax,
        act_loopP50Mean: a.loopP50Mean,
        act_loopP95Max: a.loopP95Max,
        act_loopP99Max: a.loopP99Max,
        act_loopMaxMax: a.loopMaxMax,
        act_socketsMax: a.socketsMax,
        act_cellSubsMax: a.cellSubsMax,
        act_freeMinMb: a.freeMinMb,
        durationMs: info.durationMs,
        status: st.status,
      };
      lines.push(csvHead.map((h) => csvValue(map[h])).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

function writeEnvironment() {
  const cpu = os.cpus();
  const r = ps(
    '$c = Get-CimInstance Win32_Processor; $o = Get-CimInstance Win32_OperatingSystem; "$($c.NumberOfCores)|$($c.NumberOfLogicalProcessors)|$($o.Caption)|$($o.Version)"',
  );
  const [physical, logical, caption, version] = (r.stdout ?? '').trim().split('|');
  const ver = (container, args) => {
    const out = spawnSync('docker', ['exec', container, ...args], { encoding: 'utf8', windowsHide: true });
    return (out.stdout ?? '').trim().split(/\r?\n/)[0] || null;
  };
  const envFile = (() => {
    try {
      return fs.readFileSync(path.join(repo, '.env'), 'utf8');
    } catch {
      return '';
    }
  })();
  // з url беремо лише хост і назву бази: обліковок у репозиторій не пишемо
  const db = envFile.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim() ?? '';
  const dbName = db.split('/').pop()?.split('?')[0] ?? null;
  const dbHost = db.match(/@([^/]+)\//)?.[1] ?? null;
  const env = {
    collectedAt: new Date().toISOString(),
    machine: {
      cpuModel: cpu[0]?.model?.trim() ?? null,
      coresPhysical: Number(physical) || null,
      coresLogical: Number(logical) || cpu.length,
      ramTotalMb: Math.round(os.totalmem() / 1048576),
      ramFreeAtStartMb: Math.round(os.freemem() / 1048576),
      os: `${caption ?? os.type()} ${version ?? os.release()}`,
    },
    versions: {
      node: process.version,
      postgres: ver(CONTAINERS[0], ['postgres', '--version']),
      redis: ver(CONTAINERS[1], ['redis-server', '--version']),
      playwright: readJson(path.join(here, 'node_modules/playwright/package.json'), {}).version ?? null,
      chromium: process.env.CAMPAIGN_CHROMIUM ?? null,
      vite: readJson(path.join(repo, 'node_modules/vite/package.json'), {}).version ?? null,
    },
    layout: {
      loadGeneratorAndServerShareMachine: true,
      serverProcess: 'tsx src/index.ts (без watch), NODE_ENV=test, BENCH_METRICS=1',
      clientProcess: 'vite dev, порт 5173, проксі /api і /ws на 3000',
      clientsPerGeneratorProcess:
        'усі N клієнтів в одному процесі генератора; діагностичний прогін s1-aoi-50-split — 25 на процес, два процеси',
      database: { host: dbHost, name: dbName },
      redisUsedByServer: false,
    },
    workload: {
      activityMs: 12000,
      gestureEvents: 30,
      eventsPerAnimationFrame: 3,
      gestureSwing: { x: 160, y: 110 },
      viewport: { width: 800, height: 540 },
      cellSize: 2000,
      perRegion: 5,
      regionStep: 4000,
      regionsPerRow: 4,
      objectsPerRegion: 100,
      targetSlots: [
        [400, 400],
        [1400, 400],
        [400, 1400],
        [1400, 1400],
        [900, 900],
      ],
      parallelTabs: Number(process.env.BENCH_PARALLEL ?? 6),
      drainMaxMs: 300000,
      settleMs: 8000,
      strategySetBy: 'POST /api/bench/strategy (ручка відкрита лише при BENCH_METRICS=1)',
    },
    plan: plannedRuns.map((p) => ({
      id: p.id,
      stage: p.stage,
      strategy: p.strategy,
      n: p.n,
      repeat: p.repeat,
      variant: p.variant,
      optional: !!p.optional,
    })),
  };
  writeJson(path.join(OUT, 'environment.json'), env);
  const m = env.machine;
  const v = env.versions;
  const w = env.workload;
  fs.writeFileSync(
    path.join(OUT, 'environment.md'),
    [
      `# Умови прогону ${DATE}`,
      '',
      '## Машина',
      '',
      `- Процесор: ${m.cpuModel}, ${m.coresPhysical} фізичних / ${m.coresLogical} логічних ядер`,
      `- Памʼять: ${m.ramTotalMb} МБ (вільно на старті кампанії ${m.ramFreeAtStartMb} МБ)`,
      `- ОС: ${m.os}`,
      `- Генератор навантаження і сервер — на одній машині, мережа локальна (loopback)`,
      '',
      '## Версії',
      '',
      `- Node ${v.node}`,
      `- PostgreSQL: ${v.postgres}`,
      `- Redis: ${v.redis} (контейнер піднятий, але сервер застосунку до Redis не звертається)`,
      `- Playwright ${v.playwright}, Chromium ${v.chromium ?? 'див. campaign.log'}`,
      `- Vite ${v.vite} (dev-режим: стенд імпортує стор клієнта з /src/..., у збірці цього шляху немає)`,
      '',
      '## Навантаження',
      '',
      `- Тривалість активності: ${w.activityMs} мс на прогін`,
      `- Жест: ${w.gestureEvents} подій руху, ${w.eventsPerAnimationFrame} події на кадр анімації (модель невирівняного введення ~180 Гц)`,
      `- Розмах жесту: ${w.gestureSwing.x}×${w.gestureSwing.y} одиниць`,
      `- Вікно вкладки: ${w.viewport.width}×${w.viewport.height}`,
      `- Клітинка області інтересу: ${w.cellSize} одиниць`,
      `- Розкладка ділянок: по ${w.perRegion} учасників на ділянку, крок ${w.regionStep} (через клітинку), ${w.regionsPerRow} ділянки в ряд, ${w.objectsPerRegion} обʼєктів у ділянці`,
      `- Вкладок заводиться одночасно: ${w.parallelTabs}`,
      `- Очікування збіжності: щонайдовше ${w.drainMaxMs} мс, потім ${w.settleMs} мс на осідання`,
      `- Стратегія кімнати: ${w.strategySetBy}`,
      `- Клієнтів на процес генератора: ${env.layout.clientsPerGeneratorProcess}`,
      '',
    ].join('\n'),
  );
  return env;
}

function etaFor(runs, measured) {
  let ms = 0;
  for (const r of runs) {
    const m = measured[r.n];
    const base = m ?? (ETA_MIN[r.n] ?? 16) * 60_000;
    ms += base * (r.split ? 1.2 : 1) + COOLDOWN_MS;
  }
  return ms;
}

async function main() {
  log(`кампанія ${DATE}: план ${plannedRuns.length} прогонів, тека ${OUT}`);

  const stale = readJson(PIDS, null);
  if (stale) {
    for (const key of ['server', 'vite', 'keepAwake']) killTreeIfOurs(stale[key], 'Master-project');
    log('прибрано процеси попереднього запуску кампанії');
  }
  const strays = stopStrayAppProcesses();

  const progress = readJson(PROGRESS, null) ?? { startedAt: new Date().toISOString(), runs: {} };
  progress.resumedAt = new Date().toISOString();
  writeJson(PROGRESS, progress);

  startKeepAwake();
  ensureContainers();
  killStrayChromium();

  // версію chromium беремо один раз: далі вона потрібна лише у файл умов
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ headless: true });
    process.env.CAMPAIGN_CHROMIUM = b.version();
    await b.close();
  } catch (e) {
    log(`версію chromium не зняв: ${e.message}`);
  }
  const env = writeEnvironment();
  log(
    `умови: ${env.machine.cpuModel}, ${env.machine.coresLogical} ядер, ${env.machine.ramTotalMb} МБ, node ${env.versions.node}, chromium ${env.versions.chromium}`,
  );

  const measured = {};
  const campaignStart = Date.now();
  let lastStage = null;

  for (const run of plannedRuns) {
    const st = progress.runs[run.id];
    if (st && (st.status === 'done' || st.status === 'failed' || st.status === 'skipped')) {
      log(`${run.id}: вже ${st.status} — пропускаю`);
      if (st.status === 'done' && st.durationMs) measured[run.n] = st.durationMs;
      continue;
    }

    if (run.optional) {
      const hours = (Date.now() - campaignStart) / 3_600_000;
      if (hours > OPTIONAL_AFTER_H) {
        log(`${run.id}: необовʼязковий повтор пропущено — кампанія триває вже ${hours.toFixed(1)} год`);
        progress.runs[run.id] = { status: 'skipped', why: `перевищено ${OPTIONAL_AFTER_H} год` };
        writeJson(PROGRESS, progress);
        fs.writeFileSync(path.join(OUT, 'aggregated.csv'), csvRows(progress));
        continue;
      }
    }

    if (run.stage !== lastStage) {
      const rest = plannedRuns.filter((p) => p.stage === run.stage && !progress.runs[p.id]);
      const eta = etaFor(rest, measured);
      log(
        `етап ${run.stage}: лишилось ${rest.length} прогонів, оцінка ~${Math.round(eta / 60000)} хв, орієнтовно до ${new Date(Date.now() + eta).toISOString().slice(11, 16)} UTC`,
      );
      await restartApp(`початок етапу ${run.stage}`);
      lastStage = run.stage;
    }

    if (!(await appHealthy())) await restartApp('застосунок не відповідає перед прогоном');
    ensureContainers();

    progress.runs[run.id] = { status: 'running', startedAt: new Date().toISOString(), attempts: 0 };
    writeJson(PROGRESS, progress);

    let info = null;
    const failures = [];
    for (let attempt = 1; attempt <= 2 && !info; attempt++) {
      progress.runs[run.id].attempts = attempt;
      writeJson(PROGRESS, progress);
      log(`${run.id}: спроба ${attempt} (${run.strategy}, n=${run.n}, межа ${TIMEOUT_MIN[run.n]} хв)`);
      try {
        info = await executeRun(run, attempt);
      } catch (e) {
        failures.push(`спроба ${attempt}: ${e.message}`);
        log(`${run.id}: спроба ${attempt} не вдалася — ${e.message}`);
        killStrayChromium();
        ensureContainers();
        if (attempt === 1) await restartApp('після невдалої спроби');
      }
    }

    if (info) {
      const r = info.rows[0];
      const a = info.stats.activity ?? info.stats.whole;
      measured[run.n] = info.durationMs;
      progress.runs[run.id] = {
        status: 'done',
        attempts: info.attempt,
        durationMs: info.durationMs,
        endedAt: info.endedAt,
        failures,
        converged: info.rows.every((x) => x.converged),
        idleClients: Math.max(...info.rows.map((x) => x.ownChanges.idleClients)),
      };
      log(
        `${run.id}: готово за ${minutes(info.durationMs)} хв — вх/клієнт ${r.traffic.inPerClient.n} кадрів (${Math.round(r.traffic.inPerClient.bytes / 1024)} КБ), на жест ${r.traffic.inPerClientPerGesture.n}, p95 ${r.latencyMs?.p95} мс, збіжність ${r.convergenceMs} мс, converged=${r.converged}, cpu сервера ${a.serverCoresMax} ядра, event loop p99 ${a.loopP99Max} мс, машина ${a.machineCoresMean}/${env.machine.coresLogical} ядер`,
      );
      if (info.warnings.length) log(`${run.id}: попередження стенду — ${info.warnings.join(' | ')}`);
    } else {
      progress.runs[run.id] = { status: 'failed', attempts: 2, failures };
      log(`${run.id}: ПРОВАЛ після двох спроб — ${failures.join(' | ')}`);
    }
    writeJson(PROGRESS, progress);
    fs.writeFileSync(path.join(OUT, 'aggregated.csv'), csvRows(progress));
    await sleep(COOLDOWN_MS);
  }

  log('план пройдено — зупиняю все, що підняв');
  await stopApp();
  killTree(keepAwake?.pid);
  keepAwake = null;
  killStrayChromium();
  savePids();

  const left = {
    port3000: await portBusy(SERVER_PORT),
    port5173: await portBusy(CLIENT_PORT),
    chromium: countStrayChromium(),
  };
  const done = Object.values(progress.runs).filter((x) => x.status === 'done').length;
  const failed = Object.entries(progress.runs).filter(([, x]) => x.status === 'failed');
  const skipped = Object.entries(progress.runs).filter(([, x]) => x.status === 'skipped');
  writeJson(path.join(OUT, 'summary.json'), {
    date: DATE,
    startedAt: progress.startedAt,
    finishedAt: new Date().toISOString(),
    totalMinutes: minutes(Date.now() - campaignStart),
    planned: plannedRuns.length,
    done,
    failed: failed.map(([id, x]) => ({ id, failures: x.failures })),
    skipped: skipped.map(([id, x]) => ({ id, why: x.why })),
    leftRunning: left,
    stoppedBeforeStart: strays,
  });
  fs.writeFileSync(path.join(OUT, 'aggregated.csv'), csvRows(progress));
  log(
    `кампанія завершена: ${done}/${plannedRuns.length} прогонів, провалів ${failed.length}, пропущено ${skipped.length}, разом ${minutes(Date.now() - campaignStart)} хв`,
  );
  log(
    `лишилось запущеним: порт 3000 ${left.port3000}, порт 5173 ${left.port5173}, chromium ${left.chromium}`,
  );
  log('ГОТОВО');
}

const bail = async (why) => {
  log(`аварійне завершення: ${why}`);
  await stopApp();
  killTree(keepAwake?.pid);
  killStrayChromium();
  savePids();
  process.exit(1);
};
process.on('SIGINT', () => bail('SIGINT'));
process.on('SIGTERM', () => bail('SIGTERM'));

main().catch((e) => bail(`${e.message}\n${e.stack}`));
