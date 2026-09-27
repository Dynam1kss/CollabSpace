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

// лічильник на кожному сокеті вкладки: вхідні й вихідні кадри з типом і розміром
function wsSpy() {
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

export async function launch() {
  browser = await chromium.launch({ headless: true });
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
  await api(owner.page, 'PUT', `/api/boards/${board.id}/snapshot`, { objects });
  for (const u of others) {
    await api(owner.page, 'POST', `/api/boards/${board.id}/members`, { email: u.email, role: 'EDITOR' });
    await api(u.page, 'POST', `/api/invites/${board.id}/accept`);
  }
  return board.id;
}

export const deleteBoard = (owner, id) => api(owner.page, 'DELETE', `/api/boards/${id}`);
export const snapshotOf = (user, id) => api(user.page, 'GET', `/api/boards/${id}/snapshot`);

export async function openBoard(user, boardId, strategy) {
  await user.page.goto(`${BASE}/boards/${boardId}?sync=${strategy}`);
  await user.page.waitForSelector('.board-canvas canvas');
  await user.page.waitForFunction(
    () => document.querySelector('.sync-status')?.classList.contains('live'),
    null,
    {
      timeout: 15000,
    },
  );
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
    const r = window.Konva.stages[0].findOne('#' + id).getClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
}

// жест із 30 подій руху рівно по perFrame на кадр анімації — сторінка шле їх
// сама, інакше частоту введення диктує затримка CDP, а не сценарій
export async function gesture(user, from, to, perFrame) {
  const page = user.page;
  const box = await page.locator('.board-canvas').boundingBox();
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const r = await page.evaluate(
    ([from, to, perFrame]) =>
      new Promise((resolve) => {
        const stage = window.Konva.stages[0];
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
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForTimeout(200);
  return r;
}

// камера — панорамою середньою кнопкою, шматками до 900px, як людина
export async function panTo(user, bx, by) {
  const page = user.page;
  const box = await page.locator('.board-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let step = 0; step < 80; step++) {
    const st = await page.evaluate(() => {
      const s = window.Konva.stages[0];
      return { x: s.x(), y: s.y(), k: s.scaleX() };
    });
    let dx = box.width / 2 - (bx * st.k + st.x);
    let dy = box.height / 2 - (by * st.k + st.y);
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    const len = Math.hypot(dx, dy);
    if (len > 900) {
      dx = (dx / len) * 900;
      dy = (dy / len) * 900;
    }
    await page.mouse.move(cx - dx / 2, cy - dy / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(() => document.querySelector('.sync-status')?.classList.contains('live'));
  await page.waitForTimeout(1200);
}

export function saveResults(name, data) {
  const dir = path.join(here, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base: BASE, ...data }, null, 2));
  return file;
}
