// навантажувальний прогін: одна й та сама робота на 5/10/25/50 учасниках,
// по разу в кожній зі стратегій. саме тут видно головне твердження роботи —
// у стратегій 1/2 вхідний трафік клієнта росте з кількістю учасників, бо
// кожному шлють усе, а в стратегії 3 він тримається на місці: клієнт бачить
// лише свою ділянку. 12 прогонів, результати — в results/load.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addObjects,
  boardWith,
  CELL,
  centerOf,
  clearSelection,
  close,
  contentFrames,
  contentSendTimes,
  deleteBoard,
  gesture,
  installProbe,
  launch,
  newUsers,
  objectCount,
  openBoard,
  panTo,
  readLast,
  readProbe,
  resetCounters,
  resetProbe,
  saveResults,
  serverMetrics,
  snapshotOf,
  sticky,
} from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STRATEGIES = (process.env.BENCH_STRATEGIES ?? 'per-event,batched,aoi').split(',');
const COUNTS = (process.env.BENCH_N ?? '5,10,25,50').split(',').map(Number);
// скільки вкладок заводимо й відкриваємо одночасно. більше — швидше, але
// 50 холодних стартів разом кладуть машину, і перші виміри йдуть по хворому
const PARALLEL = Number(process.env.BENCH_PARALLEL ?? 6);
const ACTIVITY_MS = Number(process.env.BENCH_ACTIVITY_MS ?? 12000);
// 2.5с дебаунсу збереження + запас на останні пакети й на сам put
const SETTLE_MS = 8000;
// скільки щонайдовше чекаємо, поки розійдеться хвіст пакетів. під
// навантаженням приймачі розгрібають чергу ще довго після останнього жесту, і
// лічильники, зняті одразу, показали б МЕНШЕ трафіку, ніж насправді пішло —
// на 50 учасниках стратегія 2 виглядала так, ніби трафік у неї впав проти 25
const DRAIN_MS = Number(process.env.BENCH_DRAIN_MS ?? 300000);
// 3 події руху на кадр — модель невирівняного введення (журнал 27.09). при
// 1 події/кадр стратегії 1 і 2 для одного обʼєкта збігаються, і порівнювати
// нема чого
const PER_FRAME = 3;
// розмах жесту. обʼєкт стоїть посеред полотна, тож і туди, і назад він має
// лишатись у межах вікна: інакше наступний клік іде повз полотно, обʼєкт не
// чіпляється, і клієнт тихо випадає з вимірювання
const SWING = { x: 160, y: 110 };
// половина стікера з lib.sticky — щоб навестись саме на його центр
const HALF = { x: 80, y: 60 };
// вікно маленьке навмисно: на 50 вкладках памʼять машини стенду впирається
// раніше за все інше, а растр полотна — найбільший шматок на вкладку. але не
// вужче за 769px: на 768 і менше застосунок переходить у вузьку розкладку й
// кладе панель інструментів УНИЗ посеред полотна — і панорама вниз починає
// тягнути не полотно, а панель
const VIEWPORT = { width: 800, height: 540 };

// правило розміщення: по 5 учасників на ділянку, ділянки — через клітинку
// сітки одна від одної, по 4 в ряд. між зайнятими клітинками завжди лишається
// одна порожня, тож вікно з запасом огляду однієї ділянки не дотягується до
// сусідньої навіть краєм
const PER_REGION = 5;
const REGION_STEP = 2 * CELL;
const REGIONS_PER_ROW = 4;
// правило щільності: 100 обʼєктів на ділянку — 95 фонових і 5 цільових, по
// одному на учасника. на 50 учасниках це рівно 1000 обʼєктів із ТЗ
const OBJECTS_PER_REGION = 100;
// цільові рознесені на ≥700 одиниць: розмах жесту вдвічі менший, тож вони не
// налазять один на одного навіть у крайніх точках
const TARGET_SLOTS = [
  [400, 400],
  [1400, 400],
  [400, 1400],
  [1400, 1400],
  [900, 900],
];

const regionsFor = (n) => Math.max(1, Math.ceil(n / PER_REGION));
// сітку ділянок центруємо на початку координат — камера в усіх стартує саме
// там, і до найдальшої ділянки виходить удвічі ближче їхати
const regionOrigin = (r) => [
  ((r % REGIONS_PER_ROW) - 2) * REGION_STEP,
  (Math.floor(r / REGIONS_PER_ROW) - 1) * REGION_STEP,
];
const targetId = (r, slot) => `t${r}-${slot}`;

function regionObjects(r) {
  const [ox, oy] = regionOrigin(r);
  const objects = [];
  const fillers = OBJECTS_PER_REGION - TARGET_SLOTS.length;
  for (let k = 0; k < fillers; k++) {
    const col = k % 10;
    const row = Math.floor(k / 10);
    objects.push(sticky(`f${r}-${k}`, ox + 120 + col * 180, oy + 200 + row * 140, k));
  }
  // цільові — поверх фонових: інакше клік по центру міг би влучити в сусіда
  TARGET_SLOTS.forEach(([dx, dy], i) => objects.push(sticky(targetId(r, i), ox + dx, oy + dy, 1000 + i)));
  return objects;
}

// скільки записів суперечать іншим: для кожного обʼєкта всі, хто його тримає,
// мають показувати те саме значення
function disagreements(states) {
  const seen = new Map();
  let bad = 0;
  for (const last of states) {
    for (const [id, rec] of Object.entries(last)) {
      const k = posKey(rec);
      if (!seen.has(id)) seen.set(id, k);
      else if (seen.get(id) !== k) bad++;
    }
  }
  return bad;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
const stats = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const round = (x) => Math.round(x * 10) / 10;
  return {
    count: s.length,
    min: round(s[0]),
    p50: round(pct(s, 0.5)),
    p95: round(pct(s, 0.95)),
    p99: round(pct(s, 0.99)),
    max: round(s[s.length - 1]),
  };
};

// ключ проби — сама позиція обʼєкта: у приймача в сторі лежить те саме
// значення, тому пара (обʼєкт, x|y) і звʼязує «відправив» з «застосував»
const posKey = (s) => `${s.x}|${s.y}`;

// мить відправлення для проби. кожна зміна свого обʼєкта в сторі — це одна
// транзакція yjs, тобто рівно один вихідний кадр вмісту, і йдуть вони в тому
// самому порядку. тому не просто «найближчий за часом», а найближчий, не
// відступаючи назад по ряду кадрів: на dragend буває запис без руху (кадр є,
// зміни в сторі нема), і без монотонності така зайвина зсувала б усі пари далі
function pairSends(samples, times) {
  let j = 0;
  const offsets = [];
  const out = samples.map((s) => {
    while (j + 1 < times.length && Math.abs(times[j + 1] - s.t) <= Math.abs(times[j] - s.t)) j++;
    const delta = Math.abs(times[j] - s.t);
    if (delta > 25) return null;
    offsets.push(delta);
    return times[j];
  });
  return { at: out, offsets };
}

// пари, у яких ключ повторився, викидаємо: жест возить обʼєкт туди-сюди зі
// зсувом, тож збіги рідкі, але однозначності від них уже нема
function uniqueByPos(samples) {
  const map = new Map();
  const dup = new Set();
  for (const s of samples) {
    const k = posKey(s);
    if (map.has(k)) dup.add(k);
    else map.set(k, s);
  }
  for (const k of dup) map.delete(k);
  return map;
}

async function run(strategy, n) {
  const regions = regionsFor(n);
  const totalObjects = regions * OBJECTS_PER_REGION;
  const label = `${strategy} / ${n}`;
  console.log(`\n== ${label}: ${regions} ділянок, ${totalObjects} обʼєктів`);

  // браузер піднімаємо заново на кожен прогін: після 50 вкладок із тисячею
  // обʼєктів памʼять повертається не одразу, і наступний прогін починався б
  // по хворій машині
  await launch(['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox']);
  const users = await newUsers(
    Array.from({ length: n }, (_, i) => `l${n}-${i}`),
    VIEWPORT,
    PARALLEL,
  );
  // на 50 вкладках із тисячею обʼєктів вкладка буває зайнята секундами, і
  // дефолтних 30с не вистачає навіть на запит рамки елемента
  for (const u of users) u.context.setDefaultTimeout(120000);
  const owner = users[0];
  const boardId = await boardWith(owner, users.slice(1), [], `Навантаження ${n}`);

  const where = users.map((_, i) => ({ region: Math.floor(i / PER_REGION), slot: i % PER_REGION }));
  const mine = users.map((_, i) => targetId(where[i].region, where[i].slot));
  // у кожній ділянці зразковим беремо учасника зі слотом 0: по ньому міряємо
  // затримку до його ж сусідів по ділянці — тих, хто в будь-якій стратегії
  // зобовʼязаний цю правку побачити
  const probeOf = users.map((_, i) => targetId(where[i].region, 0));
  const tracked = users.map((_, i) => mine[i]).filter((v, i, a) => a.indexOf(v) === i);

  await inBatches(
    users,
    async (u, i) => {
      // перепідключення в застосунку нема: зірваний сокет лікується лише
      // перезавантаженням сторінки, тож саме це й робимо
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await openBoard(u, boardId, strategy);
          return;
        } catch {
          await u.page.waitForTimeout(2000);
        }
      }
      try {
        await openBoard(u, boardId, strategy);
      } catch (err) {
        const state = await u.page.evaluate(() => ({
          status: document.querySelector('.sync-status')?.className ?? 'нема',
          canvas: !!document.querySelector('.board-canvas canvas'),
          objects: window.__stage ? window.__stage().find('Group').length : -1,
        }));
        throw new Error(`${u.label} (#${i}) не вийшов у live: ${JSON.stringify(state)}`, { cause: err });
      }
    },
    'відкрито',
  );
  await inBatches(
    users,
    async (u, i) => {
      const [ox, oy] = regionOrigin(where[i].region);
      const [dx, dy] = TARGET_SLOTS[where[i].slot];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await panTo(u, ox + dx + HALF.x, oy + dy + HALF.y);
          return;
        } catch (err) {
          // під навантаженням сервер зрідка рве сокет тому, хто не встиг
          // відповісти на ping; перепідключення в застосунку нема, тому
          // перезаходимо на дошку й наводимось наново
          if (attempt === 2) throw err;
          await openBoard(u, boardId, strategy);
        }
      }
    },
    'наведено',
  );

  // засіває по одному клієнту на ділянку, уже після того, як усі зайшли й
  // навелись. у стратегії 3 писати в клітинку може лише передплатник, тому
  // кожну ділянку створює саме той, хто в ній сидить
  for (let r = 0; r < regions; r++) await addObjects(users[r * PER_REGION], regionObjects(r));
  const expect = strategy === 'aoi' ? OBJECTS_PER_REGION : totalObjects;
  await inBatches(users, (u) => waitForObjects(u, expect), 'засіяно');
  await inBatches(users, (u, i) => installProbe(u, tracked, [mine[i], probeOf[i]]));

  for (const u of users) {
    await resetCounters(u);
    await resetProbe(u);
  }
  const memSamples = [];
  const before = await serverMetrics();
  const poll = setInterval(
    () =>
      serverMetrics().then(
        (m) => memSamples.push(m),
        () => {},
      ),
    1000,
  );

  const startedAt = Date.now();
  const deadline = startedAt + ACTIVITY_MS;
  const drives = await Promise.all(users.map((u, i) => drive(u, mine[i], deadline)));
  const activityMs = Date.now() - startedAt;
  clearInterval(poll);
  const after = await serverMetrics();

  // чекаємо, поки всі зійдуться на спільних обʼєктах, — і лише тоді знімаємо
  // лічильники. якщо за DRAIN_MS не зійшлись, прогін так і позначається:
  // усталеного режиму на цій кількості учасників система не тримає
  const drainStart = Date.now();
  let converged = false;
  while (Date.now() - drainStart < DRAIN_MS) {
    const last = [];
    for (const u of users) last.push(await readLast(u));
    if (disagreements(last) === 0) {
      converged = true;
      break;
    }
    // раз на 5с, а не частіше: саме опитування 50 завантажених вкладок теж
    // коштує, і частим опитуванням ми б заважали їм розгрібати чергу
    await users[0].page.waitForTimeout(5000);
  }
  const drainMs = Date.now() - drainStart;

  await users[0].page.waitForTimeout(SETTLE_MS);

  const probes = [];
  for (const u of users) probes.push(await readProbe(u));
  const traffic = { out: { n: 0, bytes: 0 }, in: { n: 0, bytes: 0 } };
  for (let i = 0; i < n; i++) {
    const out = await contentFrames(users[i], 'out');
    const inn = await contentFrames(users[i], 'in');
    if (process.env.BENCH_DEBUG) {
      const own = probes[i].samples.filter((x) => x.id === mine[i]).length;
      const last = probes[i].last[mine[i]];
      console.log(
        `    ${users[i].label} жестів ${drives[i].gestures} кадрів ${drives[i].frames} вих ${out.n} вх ${inn.n} своїх змін ${own} позиція ${last ? `${Math.round(last.x)},${Math.round(last.y)}` : '—'}`,
      );
    }
    traffic.out.n += out.n;
    traffic.out.bytes += out.bytes;
    traffic.in.n += inn.n;
    traffic.in.bytes += inn.bytes;
  }

  // затримка: у кожній ділянці зіставляємо ряд зразкового учасника з рядами
  // його сусідів по тій самій позиції обʼєкта
  const net = [];
  const full = [];
  let unmatched = 0;
  const pairOffsets = [];
  for (let r = 0; r < regions; r++) {
    const senderIndex = r * PER_REGION;
    if (senderIndex >= n) continue;
    const id = targetId(r, 0);
    const own = probes[senderIndex].samples.filter((x) => x.id === id);
    const times = await contentSendTimes(users[senderIndex]);
    const paired = pairSends(own, times);
    own.forEach((s, i) => (s.sentAt = paired.at[i]));
    pairOffsets.push(...paired.offsets);
    const sent = uniqueByPos(own.filter((s) => s.sentAt !== null));
    unmatched += own.filter((s) => s.sentAt === null).length;
    for (let i = 0; i < n; i++) {
      if (i === senderIndex || where[i].region !== r) continue;
      for (const got of probes[i].samples) {
        if (got.id !== id) continue;
        const s = sent.get(posKey(got));
        if (!s) continue;
        net.push(got.t - s.sentAt);
        if (s.input > 0 && s.input <= s.sentAt) full.push(got.t - s.input);
      }
    }
  }

  // збіжність: остання СВОЯ правка будь-де — це мить, коли всі спинились;
  // остання зміна будь-якого цільового обʼєкта будь-де — мить, коли всі
  // дійшли до спільного стану. різниця і є час збіжності
  let stoppedAt = 0;
  let convergedAt = 0;
  for (let i = 0; i < n; i++) {
    const own = probes[i].last[mine[i]];
    if (own) stoppedAt = Math.max(stoppedAt, own.t);
    for (const rec of Object.values(probes[i].last)) convergedAt = Math.max(convergedAt, rec.t);
  }
  const agreed = new Map();
  let holders = 0;
  for (let i = 0; i < n; i++) {
    for (const [id, rec] of Object.entries(probes[i].last)) {
      holders++;
      if (!agreed.has(id)) agreed.set(id, posKey(rec));
    }
  }
  const disagree = disagreements(probes.map((p) => p.last));

  // звірка з базою — перевірка побічна, і валити через неї весь прогін не
  // можна: на вкрай завантаженій вкладці запит знімка може й не відповісти
  let snapObjects = null;
  for (let attempt = 0; attempt < 2 && !snapObjects; attempt++) {
    const snap = await snapshotOf(owner, boardId).catch(() => null);
    if (Array.isArray(snap?.objects)) snapObjects = snap.objects;
    else await owner.page.waitForTimeout(2000);
  }
  const inDb = new Map((snapObjects ?? []).map((o) => [o.id, posKey(o)]));
  let dbMismatch = snapObjects ? 0 : null;
  if (snapObjects) for (const [id, k] of agreed) if (inDb.get(id) !== k) dbMismatch++;

  const wallSeconds = (after.at - before.at) / 1000;
  const cpuMs = (after.cpu.user - before.cpu.user + (after.cpu.system - before.cpu.system)) / 1000;
  const peak = (field) => Math.max(...memSamples.map((m) => m.memory[field]), after.memory[field]);

  // скільки власних змін записав кожен — так видно клієнта, у якого жести не
  // чіплялись: його мовчання інакше занизило б трафік усього прогону
  const ownChanges = [];
  for (let i = 0; i < n; i++) ownChanges.push(probes[i].samples.filter((x) => x.id === mine[i]).length);
  const sortedOwn = [...ownChanges].sort((a, b) => a - b);
  const medianOwn = sortedOwn[Math.floor(sortedOwn.length / 2)];
  const idle = ownChanges.filter((c) => c < medianOwn / 2).length;

  // трафік нормуємо на один ВЛАСНИЙ жест клієнта: під навантаженням вкладки
  // встигають зробити різну кількість жестів, і сирі суми порівнювали б не
  // стратегії, а спритність емулятора
  const perClientGestures = drives.reduce((a, d) => a + d.gestures, 0) / n;
  const perGesture = (v) => Math.round((v / perClientGestures) * 10) / 10;

  const row = {
    strategy,
    n,
    regions,
    objects: totalObjects,
    activityMs,
    gestures: drives.reduce((a, d) => a + d.gestures, 0),
    gestureFrames: drives.reduce((a, d) => a + d.frames, 0),
    traffic: {
      out: traffic.out,
      in: traffic.in,
      outPerClient: { n: traffic.out.n / n, bytes: Math.round(traffic.out.bytes / n) },
      inPerClient: { n: traffic.in.n / n, bytes: Math.round(traffic.in.bytes / n) },
      inPerClientPerGesture: {
        n: perGesture(traffic.in.n / n),
        bytes: perGesture(traffic.in.bytes / n),
      },
      outPerClientPerGesture: {
        n: perGesture(traffic.out.n / n),
        bytes: perGesture(traffic.out.bytes / n),
      },
    },
    perClientGestures: Math.round(perClientGestures * 10) / 10,
    ownChanges: { min: sortedOwn[0], median: medianOwn, max: sortedOwn[n - 1], idleClients: idle },
    latencyMs: stats(net),
    latencyFullMs: stats(full),
    unmatchedProbes: unmatched,
    // наскільки запис у стор розходиться з власним кадром у сокеті. має бути
    // дрібницею проти відстані між кадрами — тоді пара однозначна
    pairOffsetMs: stats(pairOffsets),
    convergenceMs: Math.round(convergedAt - stoppedAt),
    converged,
    drainMs,
    agreement: {
      objects: agreed.size,
      holders,
      disagree,
      dbMismatch,
      inDb: snapObjects ? snapObjects.length : null,
    },
    server: {
      wallSeconds: Math.round(wallSeconds * 10) / 10,
      cpuMs: Math.round(cpuMs),
      cpuPercentOfCore: Math.round((cpuMs / 1000 / wallSeconds) * 1000) / 10,
      rssPeakMb: Math.round(peak('rss') / 1024 / 1024),
      heapPeakMb: Math.round(peak('heapUsed') / 1024 / 1024),
      rooms: after.rooms,
    },
  };

  console.log(
    `  жестів ${row.gestures}, вхідних кадрів на клієнта ${row.traffic.inPerClient.n.toFixed(0)} (${(row.traffic.inPerClient.bytes / 1024).toFixed(0)} КБ), на жест ${row.traffic.inPerClientPerGesture.n}, ` +
      `p50 ${row.latencyMs?.p50} мс, p95 ${row.latencyMs?.p95} мс (проб ${row.latencyMs?.count}), ` +
      `збіжність ${row.convergenceMs} мс, cpu ${row.server.cpuPercentOfCore}%, rss ${row.server.rssPeakMb} МБ`,
  );
  if (idle) console.log(`  УВАГА: у ${idle} клієнтів жести не чіплялись — прогін недійсний`);
  if (disagree)
    console.log(`  УВАГА: не зійшлись за ${Math.round(drainMs / 1000)}с — розбіжність у ${disagree} записах`);
  if (dbMismatch === null) console.log('  УВАГА: знімок з бази не прочитався — звірку пропущено');
  else if (dbMismatch) console.log(`  УВАГА: у базі не збігається ${dbMismatch} обʼєктів`);
  if (row.latencyMs && row.latencyMs.min < 0)
    console.log(`  УВАГА: відʼємна затримка ${row.latencyMs.min} мс — годинники сторінок розʼїхались`);

  await deleteBoard(owner, boardId);
  await close();
  return row;
}

// жест туди-сюди з невеликим зносом: зворотний хід коротший за прямий, тому
// обʼєкт не повертається в ту саму точку і позиції в пробі не повторюються.
// паузи довші за мінімальні: якщо наступний mouse.down іде надто швидко по
// попередньому mouse.up, браузер його часом ковтає — жест тоді не чіпляє
// обʼєкт зовсім, і клієнт тихо випадає з вимірювання
async function drive(user, id, deadline) {
  const box = await user.page.locator('.board-canvas').boundingBox();
  let k = 0;
  let frames = 0;
  while (Date.now() < deadline) {
    await clearSelection(user);
    const c = await centerOf(user, id);
    if (c.x < 0 || c.y < 0 || c.x > box.width || c.y > box.height)
      throw new Error(`${user.label}: ${id} виїхав за полотно (${Math.round(c.x)},${Math.round(c.y)})`);
    const to =
      k % 2 === 0 ? { x: c.x + SWING.x, y: c.y + SWING.y } : { x: c.x - SWING.x + 3, y: c.y - SWING.y + 2 };
    frames += (await gesture(user, c, to, PER_FRAME, { hold: 150, settle: 150, box })).frames;
    k++;
  }
  return { gestures: k, frames };
}

// чекаємо, поки засів долетить: у стратегіях 1/2 це вся дошка, у третій —
// лише своя ділянка
async function waitForObjects(user, expected) {
  for (let i = 0; i < 120; i++) {
    if ((await objectCount(user)) >= expected) return;
    await user.page.waitForTimeout(500);
  }
  throw new Error(`${user.label}: не дочекався ${expected} обєктів`);
}

const inBatches = async (users, fn, what = '', size = PARALLEL) => {
  for (let i = 0; i < users.length; i += size) {
    const at = Date.now();
    await Promise.all(users.slice(i, i + size).map((u, k) => fn(u, i + k)));
    if (process.env.BENCH_DEBUG && what)
      console.log(`    ${what} ${Math.min(i + size, users.length)}/${users.length} (${Date.now() - at} мс)`);
  }
};

// прогони довгі: результат пишемо після кожного й доливаємо до того, що вже
// наміряно, щоб падіння на останньому N не зносило решту
function previousRows() {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'results', 'load.json'), 'utf8')).rows ?? [];
  } catch {
    return [];
  }
}

// без метрик сервера прогін рахувати нема сенсу — краще впасти одразу
await serverMetrics();
const rows = previousRows().filter((r) => !(COUNTS.includes(r.n) && STRATEGIES.includes(r.strategy)));
const order = (r) => r.n * 10 + ['per-event', 'batched', 'aoi'].indexOf(r.strategy);
for (const n of COUNTS) {
  for (const strategy of STRATEGIES) {
    rows.push(await run(strategy, n));
    rows.sort((a, b) => order(a) - order(b));
    saveResults('load', { activityMs: ACTIVITY_MS, perFrame: PER_FRAME, rows });
  }
}

console.log('\nрезультат:', saveResults('load', { activityMs: ACTIVITY_MS, perFrame: PER_FRAME, rows }));
