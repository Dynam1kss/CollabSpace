import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// спільне для сценаріїв стенду: справжній застосунок у безголовому chromium,
// свіжі акаунти на кожен прогін (жодних збережених профілів), лічильник кадрів
// на сокеті в кожній вкладці

export const BASE = process.env.BENCH_BASE ?? 'http://localhost:5173';
export const CELL = 2000;
const here = path.dirname(fileURLToPath(import.meta.url));

// типи кадрів, що несуть вміст дошки (shared/src/sync.ts)
export const UPDATE = 0;
export const CELL_UPDATE = 22;

// лічильник на кожному сокеті вкладки: вхідні й вихідні кадри з типом і розміром.
// тут же — пошук ЖИВОГО полотна: Konva.stages тримає й відчеплені, а після
// перемонтування [0] лишається зі стартовими координатами назавжди, і панорама
// по ньому крутиться вхолосту, нічого не рухаючи
function wsSpy() {
  window.__stage = () =>
    window.Konva.stages.filter((s) => document.contains(s.container())).pop() ?? window.Konva.stages[0];
  window.__ws = { in: [], out: [] };
  const Orig = window.WebSocket;
  class Spy extends Orig {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (e) => {
        const b = new Uint8Array(e.data);
        window.__ws.in.push({ t: performance.now(), type: b[0], len: b.length });
      });
    }
    send(data) {
      const b = data instanceof Uint8Array ? data : new Uint8Array(data);
      window.__ws.out.push({ t: performance.now(), type: b[0], len: b.length });
      return super.send(data);
    }
  }
  window.WebSocket = Spy;
}

let browser = null;

export async function launch(args = []) {
  browser = await chromium.launch({ headless: true, args });
  return browser;
}

export async function close() {
  await browser?.close();
}

// новий акаунт у власному контексті браузера. ліміт реєстрацій на сервері —
// 10 за 15 хв з однієї адреси, сценарії беруть по 2–4
export async function newUser(label, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(wsSpy);
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('.auth-card');
  const email = `bench-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@bench.local`;
  const status = await page.evaluate(
    ([email, label]) =>
      fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'bench-password', displayName: `Стенд ${label}` }),
      }).then((r) => r.status),
    [email, label],
  );
  if (status !== 201) throw new Error(`реєстрація ${label}: ${status} (ліміт спроб? див. README)`);
  return { label, email, context, page };
}

const api = (page, method, url, body) =>
  page.evaluate(
    ([method, url, body]) =>
      fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }).then((r) => (r.headers.get('content-type')?.includes('json') ? r.json() : r.status)),
    [method, url, body],
  );

// дошка з готовим вмістом, решта користувачів — редактори
export async function boardWith(owner, others, objects, title = 'Стенд') {
  const board = await api(owner.page, 'POST', '/api/boards', { title });
  // порожній список — дошку лишаємо порожньою (load.mjs засіває її руками
  // клієнтів уже після того, як усі зайшли)
  if (objects.length) await api(owner.page, 'PUT', `/api/boards/${board.id}/snapshot`, { objects });
  for (const u of others) {
    await api(owner.page, 'POST', `/api/boards/${board.id}/members`, { email: u.email, role: 'EDITOR' });
    await api(u.page, 'POST', `/api/invites/${board.id}/accept`);
  }
  return board.id;
}

export const deleteBoard = (owner, id) => api(owner.page, 'DELETE', `/api/boards/${id}`);
export const snapshotOf = (user, id) => api(user.page, 'GET', `/api/boards/${id}/snapshot`);

// режим кімнати тепер вибирає сервер і оголошує його клієнтам першим кадром
// (журнал 05.10) — браузеру цього не віддають, бо саме з того, що режим жив у
// localStorage, і розʼїхалась кімната. Тому стенд переставляє режим на сервері,
// а не дописує ?sync= в адресу
export async function setServerStrategy(strategy) {
  const r = await fetch(`${BASE}/api/bench/strategy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategy }),
  });
  if (!r.ok) {
    throw new Error(`/api/bench/strategy: ${r.status} (сервер без BENCH_METRICS=1?)`);
  }
}

export async function openBoard(user, boardId, strategy) {
  await user.page.goto(`${BASE}/boards/${boardId}`);
  // 60с на обидва чекання: на дошці в тисячу обʼєктів і з півсотнею вкладок
  // разом і перший кадр, і рукостискання бувають довгими — це не привід валити
  // прогін
  await user.page.waitForSelector('.board-canvas canvas', { timeout: 60000 });
  await user.page.waitForFunction(
    () => document.querySelector('.sync-status')?.classList.contains('live'),
    null,
    { timeout: 60000 },
  );
  // звіряємо, що клієнт узяв саме той режим: інакше прогін тихо міряв би не те
  const adopted = await user.page.getAttribute('.sync-status', 'data-strategy');
  if (adopted !== strategy) {
    throw new Error(`клієнт працює в режимі ${adopted}, а прогін просив ${strategy}`);
  }
  await user.page.waitForTimeout(500);
}

export const now = new Date().toISOString();
export const sticky = (id, x, y, z = 0) => ({
  id,
  type: 'sticky',
  x,
  y,
  width: 160,
  height: 120,
  rotation: 0,
  zIndex: z,
  createdBy: 'bench',
  createdAt: now,
  text: id,
  fillColor: '#fef08a',
  textColor: '#1f2937',
  column: null,
});

export const resetCounters = (user) =>
  user.page.evaluate(() => ((window.__ws.in = []), (window.__ws.out = [])));

// кадри вмісту (UPDATE для стратегій 1/2, CELL_UPDATE для 3)
export const contentFrames = (user, dir) =>
  user.page.evaluate(
    ([dir, types]) => {
      const f = window.__ws[dir].filter((x) => types.includes(x.type));
      return { n: f.length, bytes: f.reduce((s, x) => s + x.len, 0) };
    },
    [dir, [UPDATE, CELL_UPDATE]],
  );

export async function centerOf(user, id) {
  return user.page.evaluate((id) => {
    const node = window.__stage().findOne('#' + id);
    const r = node.getClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
}

// жест із 30 подій руху рівно по perFrame на кадр анімації — сторінка шле їх
// сама, інакше частоту введення диктує затримка CDP, а не сценарій
export async function gesture(user, from, to, perFrame, { hold = 800, settle = 200, box } = {}) {
  const page = user.page;
  // рамку полотна можна передати готовою: вона за прогін не міняється, а на
  // геть завантаженій вкладці сам запит рамки не встигає за таймаут
  box ??= await page.locator('.board-canvas').boundingBox();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const r = await page.evaluate(
    ([from, to, perFrame]) =>
      new Promise((resolve) => {
        const stage = window.__stage();
        const canvas = stage.content.querySelector('canvas');
        const rect = stage.container().getBoundingClientRect();
        const at = (i) => ({
          clientX: rect.left + from.x + ((to.x - from.x) * i) / 30,
          clientY: rect.top + from.y + ((to.y - from.y) * i) / 30,
        });
        let i = 0;
        let frames = 0;
        const tick = () => {
          frames++;
          for (let k = 0; k < perFrame && i < 30; k++) {
            i++;
            const p = at(i);
            // мить самої дії — від неї міряється повна затримка (load.mjs)
            if (window.__probe) window.__probe.lastInput = performance.timeOrigin + performance.now();
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                ...p,
                bubbles: true,
                buttons: 1,
                pointerId: 1,
                isPrimary: true,
                pointerType: 'mouse',
              }),
            );
            canvas.dispatchEvent(new MouseEvent('mousemove', { ...p, bubbles: true, buttons: 1 }));
          }
          if (i < 30) return requestAnimationFrame(tick);
          requestAnimationFrame(() => {
            const p = at(30);
            canvas.dispatchEvent(
              new PointerEvent('pointerup', {
                ...p,
                bubbles: true,
                pointerId: 1,
                isPrimary: true,
                pointerType: 'mouse',
              }),
            );
            canvas.dispatchEvent(new MouseEvent('mouseup', { ...p, bubbles: true }));
            resolve({ frames });
          });
        };
        requestAnimationFrame(tick);
      }),
    [from, to, perFrame],
  );
  await page.waitForTimeout(hold);
  await page.mouse.up();
  await page.waitForTimeout(settle);
  return r;
}

// камера — панорамою середньою кнопкою, шматками, як людина. шматок не може
// бути більший за саме полотно: половина його відкладається від центру в
// кожен бік, і при 900px у вікні 900×600 миша виїжджала за нижній край
// сторінки — подія нікуди не доходила, і далека ділянка лишалась недосяжною
export async function panTo(user, bx, by) {
  const page = user.page;
  const box = await page.locator('.board-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // шматок тримаємо в середній частині полотна: по краях трапляються панелі,
  // а тягання, що почалось на панелі, полотно не рухає
  const maxStep = Math.min(box.width, box.height) * 0.6;
  const away = async () => {
    const st = await page.evaluate(() => {
      const s = window.__stage();
      return { x: s.x(), y: s.y(), k: s.scaleX() };
    });
    return { dx: box.width / 2 - (bx * st.k + st.x), dy: box.height / 2 - (by * st.k + st.y) };
  };
  // кілька заходів: на завантаженій машині вкладка буває настільки зайнята, що
  // жодна подія панорами до неї не доходить, і цикл крутиться вхолосту. мовчки
  // лишити камеру на місці не можна — клієнт тоді дивиться не туди, куди треба,
  // і весь його вимір летить у смітник
  let left = await away();
  for (let attempt = 0; attempt < 3 && (Math.abs(left.dx) >= 2 || Math.abs(left.dy) >= 2); attempt++) {
    for (let step = 0; step < 200; step++) {
      let { dx, dy } = await away();
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
      const len = Math.hypot(dx, dy);
      if (len > maxStep) {
        dx = (dx / len) * maxStep;
        dy = (dy / len) * maxStep;
      }
      await page.mouse.move(cx - dx / 2, cy - dy / 2);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      await page.waitForTimeout(30);
    }
    left = await away();
    if (Math.abs(left.dx) >= 2 || Math.abs(left.dy) >= 2) await page.waitForTimeout(1000);
  }
  if (Math.abs(left.dx) >= 2 || Math.abs(left.dy) >= 2) {
    const info = await page.evaluate(() => ({
      stages: window.Konva.stages.length,
      live: window.Konva.stages.filter((s) => document.contains(s.container())).length,
      status: document.querySelector('.sync-status')?.className ?? 'нема',
    }));
    throw new Error(
      `${user.label}: камера не доїхала до ${bx},${by} (лишилось ${Math.round(left.dx)},${Math.round(left.dy)}, ${JSON.stringify(info)})`,
    );
  }
  // після панорами по великій дошці клієнт часом перечіпляється (стратегія 3
  // переписує передплати), а на завантаженій машині це не миттєво
  await page.waitForFunction(() => document.querySelector('.sync-status')?.classList.contains('live'), null, {
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
}

export function saveResults(name, data) {
  const dir = path.join(here, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base: BASE, ...data }, null, 2));
  return file;
}

// ---- навантажувальний прогін (load.mjs) ----

// акаунти пачками: 50 реєстрацій поспіль — це 50 argon2 і 50 контекстів,
// послідовно виходить довго, усі разом — браузер захлинається
export async function newUsers(labels, viewport, parallel = 6) {
  const users = [];
  for (let i = 0; i < labels.length; i += parallel) {
    const batch = labels.slice(i, i + parallel);
    users.push(...(await Promise.all(batch.map((l) => newUser(l, viewport)))));
  }
  return users;
}

// зонд затримки й збіжності. пишемо не в сокеті, а в СТОРІ клієнта: саме там
// правка стає видимою застосунку, і шлях однаковий у всіх трьох стратегіях
// (у третій дзеркало збирається з документів клітинок). час абсолютний —
// сторінки в різних процесах, у кожної свій нуль performance.now()
//
// tracked — по яких обʼєктах тримати останнє значення й час (це дає збіжність),
// sampled — по яких ще й складати повний ряд із часом дії (це дає затримку)
export async function installProbe(user, tracked, sampled) {
  await user.page.evaluate(
    async ([tracked, sampled]) => {
      // url з performance entries, а не '/src/...': після hmr статичний шлях
      // віддає ДРУГИЙ екземпляр модуля, і стор у ньому чужий
      const url = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => n.split('?')[0].endsWith('/src/canvas/board-store.ts'));
      const m = await import(url);
      const probe = { samples: [], last: {}, seen: {}, lastInput: 0 };
      window.__probe = probe;
      const wanted = new Set(sampled);
      m.useBoardStore.subscribe((state) => {
        const t = performance.timeOrigin + performance.now();
        for (const id of tracked) {
          const o = state.objects[id];
          if (!o) continue;
          const prev = probe.seen[id];
          if (prev && prev.x === o.x && prev.y === o.y) continue;
          probe.seen[id] = { x: o.x, y: o.y };
          probe.last[id] = { x: o.x, y: o.y, t };
          if (wanted.has(id)) probe.samples.push({ id, x: o.x, y: o.y, t, input: probe.lastInput });
        }
      });
    },
    [tracked, sampled],
  );
}

// створити обʼєкти руками клієнта, а не покласти знімком через rest. інакше
// в стратегіях 1/2 кожен, хто заходить на дошку зі знімком, перекладає його
// в документ СВОЇМИ записами й розсилає всім, хто вже в кімнаті: вартість
// входу росте з розміром кімнати, і на півсотні вкладок сервер починає рвати
// сокети тим, хто не встигає. тут дошка порожня, поки всі не зайшли
export async function addObjects(user, objects) {
  await user.page.evaluate(async (objects) => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.split('?')[0].endsWith('/src/canvas/board-store.ts'));
    const m = await import(url);
    // однією транзакцією — один пакет замість сотні (у клітинках усе одно
    // вийде по транзакції на клітинку)
    m.asAppEdit(() => {
      for (const o of objects) m.useBoardStore.getState().add(o);
    });
  }, objects);
}

// зняти виділення перед наступним жестом. поки обʼєкт виділений, тягання
// синтетичними подіями його не зрушує — жест іде вхолосту, і клієнт тихо
// випадає з вимірювання. порожнім кліком не обійтись: на засіяній дошці вільної
// точки в кадрі може й не бути
export const clearSelection = (user) =>
  user.page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.split('?')[0].endsWith('/src/canvas/editor-store.ts'));
    const m = await import(url);
    m.useEditorStore.getState().clearSelection();
  });

// скільки обʼєктів зараз у дзеркалі клієнта
export const objectCount = (user) =>
  user.page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.split('?')[0].endsWith('/src/canvas/board-store.ts'));
    const m = await import(url);
    return Object.keys(m.useBoardStore.getState().objects).length;
  });

export const resetProbe = (user) =>
  user.page.evaluate(() => {
    const p = window.__probe;
    p.samples = [];
    p.last = {};
    p.seen = {};
  });

// абсолютний час кожного вихідного кадру вмісту. мить відправлення беремо
// саме тут, а не з підписки на стор: send() у сокеті й дзеркало стору
// спрацьовують у різному порядку всередині однієї транзакції yjs, і за
// дзеркалом у відправника виходила затримка на пару мс меншою за нуль
export const contentSendTimes = (user) =>
  user.page.evaluate(
    (types) => window.__ws.out.filter((f) => types.includes(f.type)).map((f) => performance.timeOrigin + f.t),
    [UPDATE, CELL_UPDATE],
  );

// лише останні значення — цим опитуємо, чи стани вже зійшлись, не тягаючи
// весь ряд проб
export const readLast = (user) => user.page.evaluate(() => window.__probe.last);

export const readProbe = (user) =>
  user.page.evaluate(() => ({ samples: window.__probe.samples, last: window.__probe.last }));

// cpu/память самого серверного процесу. вмикається на сервері BENCH_METRICS=1
export async function serverMetrics() {
  const r = await fetch(BASE + '/api/metrics');
  if (!r.ok) throw new Error(`/api/metrics: ${r.status} (сервер без BENCH_METRICS=1?)`);
  return r.json();
}
