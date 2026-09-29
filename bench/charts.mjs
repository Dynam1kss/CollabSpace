// графіки для розділу 4 записки й постера з results/load.json.
// svg збираємо руками, png знімаємо тим самим chromium, що ганяє стенд —
// окрема бібліотека графіків заради чотирьох ліній того не варта
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'results', 'charts');
const data = JSON.parse(fs.readFileSync(path.join(here, 'results', 'load.json'), 'utf8'));

// перші три слоти категорійної палітри — перевірені на розрізнюваність,
// зокрема при дальтонізмі
const SERIES = [
  { key: 'per-event', name: '1 — на кожну подію', color: '#2a78d6' },
  { key: 'batched', name: '2 — пакетна', color: '#eb6834' },
  { key: 'aoi', name: '3 — область інтересу', color: '#1baf7a' },
];

const INK = '#0b0b0b';
const INK_SOFT = '#52514e';
const GRID = '#e3e2df';
const SURFACE = '#fcfcfb';
const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

const W = 940;
const H = 580;
const M = { top: 108, right: 210, bottom: 96, left: 96 };
const plotW = W - M.left - M.right;
const plotH = H - M.top - M.bottom;

const counts = [...new Set(data.rows.map((r) => r.n))].sort((a, b) => a - b);
const at = (strategy, n) => data.rows.find((r) => r.strategy === strategy && r.n === n);

// поділки логарифмічної осі: 1-2-5 на кожен порядок
function logTicks(min, max) {
  const out = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)) + 1; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, e);
      if (v < min / 1.001) continue;
      out.push(v);
      // доводимо шкалу до першої поділки, що накриває максимум, — інакше
      // найбільша точка опиняється над полем графіка
      if (v >= max) return out;
    }
  }
  return out;
}

// «круглий» крок осі: 1, 2, 2.5 або 5 на порядок
function ticksUpTo(max) {
  if (max <= 0) return [0, 1];
  const raw = max / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out = [];
  for (let v = 0; v <= max * 1.0001 + step; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);

// одна лінія на стратегію; підпис серії — прямо біля кінця лінії, бо в цій
// палітрі бірюзовий на світлому тлі не добирає контрасту для самого лише кольору
function chart({ title, subtitle, unit, value, reference, log, markUnconverged }) {
  const series = SERIES.map((s) => ({
    ...s,
    points: counts
      .map((n) => ({ n, v: value(at(s.key, n)), converged: (at(s.key, n)?.agreement.disagree ?? 0) === 0 }))
      .filter((p) => p.v !== null && p.v !== undefined),
  })).filter((s) => s.points.length);

  const all = series.flatMap((s) => s.points.map((p) => p.v));
  const maxValue = Math.max(...all, reference ? reference.value : 0);
  const minValue = Math.min(...all, reference ? reference.value : Infinity);
  // на логарифмічній осі беремо на порядок нижче за найменше значення
  const yMin = log ? Math.pow(10, Math.floor(Math.log10(minValue))) : 0;
  const yTicks = log ? logTicks(yMin, maxValue) : ticksUpTo(maxValue);
  const yMax = yTicks[yTicks.length - 1];
  const xMin = counts[0];
  const xMax = counts[counts.length - 1];

  const px = (n) => M.left + ((n - xMin) / (xMax - xMin)) * plotW;
  const py = (v) =>
    log
      ? M.top +
        plotH -
        ((Math.log10(Math.max(v, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * plotH
      : M.top + plotH - (v / yMax) * plotH;

  const parts = [];
  parts.push(
    `<rect width="${W}" height="${H}" fill="${SURFACE}"/>`,
    `<text x="${M.left}" y="38" font-family="${FONT}" font-size="22" font-weight="600" fill="${INK}">${esc(title)}</text>`,
    `<text x="${M.left}" y="62" font-family="${FONT}" font-size="14" fill="${INK_SOFT}">${esc(subtitle)}</text>`,
  );

  for (const t of yTicks) {
    parts.push(
      `<line x1="${M.left}" y1="${py(t)}" x2="${M.left + plotW}" y2="${py(t)}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${M.left - 12}" y="${py(t) + 5}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${INK_SOFT}">${fmt(t)}</text>`,
    );
  }
  for (const n of counts) {
    parts.push(
      `<text x="${px(n)}" y="${M.top + plotH + 26}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${INK_SOFT}">${n}</text>`,
    );
  }
  parts.push(
    `<line x1="${M.left}" y1="${M.top + plotH}" x2="${M.left + plotW}" y2="${M.top + plotH}" stroke="${INK_SOFT}" stroke-width="1"/>`,
    `<text x="${M.left + plotW / 2}" y="${H - 46}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${INK}">кількість одночасних учасників дошки, осіб</text>`,
    `<text transform="translate(26 ${M.top + plotH / 2}) rotate(-90)" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${INK}">${esc(unit)}</text>`,
  );

  if (reference) {
    parts.push(
      `<line x1="${M.left}" y1="${py(reference.value)}" x2="${M.left + plotW}" y2="${py(reference.value)}" stroke="${INK_SOFT}" stroke-width="1.5" stroke-dasharray="7 5"/>`,
      `<text x="${M.left + plotW - 6}" y="${py(reference.value) - 9}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${INK_SOFT}">${esc(reference.label)}</text>`,
    );
  }

  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${px(p.n).toFixed(1)} ${py(p.v).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const p of s.points) {
      // обвідка кольором тла — там, де лінії перетинаються, точки не зливаються
      const hollow = markUnconverged && !p.converged;
      parts.push(
        `<circle cx="${px(p.n).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="4.5" fill="${hollow ? SURFACE : s.color}" stroke="${hollow ? s.color : SURFACE}" stroke-width="2"/>`,
      );
    }
    const last = s.points[s.points.length - 1];
    parts.push(
      `<text x="${px(last.n) + 12}" y="${py(last.v) + 5}" font-family="${FONT}" font-size="13" fill="${INK}">${esc(s.name)}</text>`,
    );
  }

  // легенда над полем: ідентичність серії не тримається на самому кольорі
  let lx = M.left;
  for (const s of series) {
    parts.push(
      `<line x1="${lx}" y1="86" x2="${lx + 22}" y2="86" stroke="${s.color}" stroke-width="2"/>`,
      `<circle cx="${lx + 11}" cy="86" r="4.5" fill="${s.color}"/>`,
      `<text x="${lx + 30}" y="91" font-family="${FONT}" font-size="13" fill="${INK}">${esc(s.name)}</text>`,
    );
    lx += 30 + s.name.length * 7.4 + 26;
  }

  if (markUnconverged) {
    parts.push(
      `<text x="${M.left + plotW / 2}" y="${H - 8}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${INK_SOFT}">${esc(HOLLOW_NOTE)}</text>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${parts.join('')}</svg>`;
}

// у прогонах, де стани так і не зійшлись, виміряне — нижня межа: частину
// пакетів приймачі просто не встигли отримати. такі точки малюємо порожнім
// маркером, щоб їх не читали як усталений режим
const HOLLOW = 'на один власний жест редагування';
const HOLLOW_NOTE = 'порожній маркер — система не вийшла в усталений режим: значення є нижньою межею';

const charts = [
  {
    file: 'traffic-packets',
    title: 'Вхідний потік вмісту на одного клієнта',
    subtitle: HOLLOW,
    unit: 'кадрів вмісту на клієнта за жест, шт.',
    value: (r) => r?.traffic.inPerClientPerGesture.n,
    log: true,
    markUnconverged: true,
  },
  {
    file: 'traffic-bytes',
    title: 'Обсяг вхідного вмісту на одного клієнта',
    subtitle: HOLLOW,
    unit: 'обсяг вмісту на клієнта за жест, КБ',
    value: (r) => (r ? Math.round((r.traffic.inPerClientPerGesture.bytes / 1024) * 100) / 100 : null),
    log: true,
    markUnconverged: true,
  },
  {
    file: 'latency-p95',
    title: 'Затримка синхронізації, 95-й процентиль',
    subtitle: 'від відправлення правки до її застосування в сусіда тієї самої ділянки',
    unit: 'затримка p95, мс (логарифмічна шкала)',
    value: (r) => r?.latencyMs?.p95,
    reference: { value: 150, label: 'цільове значення за ТЗ — 150 мс' },
    log: true,
    markUnconverged: true,
  },
  {
    file: 'convergence',
    title: 'Час збіжності станів',
    subtitle: 'від останньої правки на дошці до однакового стану в усіх клієнтів',
    unit: 'час збіжності, мс (логарифмічна шкала)',
    value: (r) => r?.convergenceMs,
    log: true,
    markUnconverged: true,
  },
];

fs.mkdirSync(outDir, { recursive: true });
const svgs = charts.map((c) => ({ ...c, svg: chart(c) }));
for (const c of svgs) fs.writeFileSync(path.join(outDir, `${c.file}.svg`), c.svg);

const browser = await chromium.launch({ headless: true });
// подвійна щільність: у записці й на постері графіки друкуються
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const c of svgs) {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${SURFACE}">${c.svg}</body></html>`,
  );
  await page.locator('svg').screenshot({ path: path.join(outDir, `${c.file}.png`) });
  console.log(`${c.file}.svg / .png`);
}
await browser.close();
console.log('графіки:', outDir);
