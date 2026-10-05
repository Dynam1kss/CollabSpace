// стратегії 1/2/3 на ОДНІЙ ділянці дошки: скільки пакетів і байтів вмісту
// коштує один жест на 30 подій руху. той, хто тягне, і сусід дивляться в одне
// місце — тут видно лише різницю від пакетування (стратегія 3 тут поводиться
// як 2: відсікати нікого). відсікання по області — див. aoi.mjs
import {
  boardWith,
  centerOf,
  close,
  contentFrames,
  deleteBoard,
  gesture,
  launch,
  newUser,
  now,
  openBoard,
  resetCounters,
  saveResults,
  setServerStrategy,
  sticky,
} from './lib.mjs';

const STRATEGIES = (process.env.BENCH_STRATEGIES ?? 'per-event,batched,aoi').split(',');

const connector = {
  id: 'c1',
  type: 'connector',
  x: -200,
  y: 300,
  width: 200,
  height: 0,
  rotation: 0,
  zIndex: 10,
  createdBy: 'bench',
  createdAt: now,
  points: [
    { x: -200, y: 300 },
    { x: 0, y: 300 },
  ],
  strokeColor: '#1f2937',
  strokeWidth: 2,
  arrowEnd: true,
};
const objects = [
  sticky('s1', -300, -150, 1),
  sticky('s2', -100, -150, 2),
  sticky('s3', 100, -150, 3),
  connector,
];

await launch();
const owner = await newUser('owner');
const peer = await newUser('peer', { width: 1000, height: 700 });

// сам обʼєкт зі стору як json — порівнюємо кінцевий стан байт у байт
const storeState = (user, ids) =>
  user.page.evaluate(async (ids) => {
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.split('?')[0].endsWith('/src/canvas/board-store.ts'));
    const m = await import(url);
    return ids.map((id) => JSON.stringify(m.useBoardStore.getState().getById(id))).join(' | ');
  }, ids);

const scenarios = {
  'стікер, 1 подія/кадр': async () => {
    const c = await centerOf(owner, 's1');
    return { r: await gesture(owner, c, { x: c.x + 240, y: c.y + 180 }, 1), ids: ['s1'] };
  },
  'стікер, 3 події/кадр': async () => {
    const c = await centerOf(owner, 's1');
    return { r: await gesture(owner, c, { x: c.x + 240, y: c.y + 180 }, 3), ids: ['s1'] };
  },
  'група з 3, 1 подія/кадр': async () => {
    await selectAll();
    const c = await centerOf(owner, 's2');
    return { r: await gesture(owner, c, { x: c.x + 150, y: c.y + 200 }, 1), ids: ['s1', 's2', 's3'] };
  },
  'група з 3, 3 події/кадр': async () => {
    await selectAll();
    const c = await centerOf(owner, 's2');
    return { r: await gesture(owner, c, { x: c.x + 150, y: c.y + 200 }, 3), ids: ['s1', 's2', 's3'] };
  },
  'точка конектора, 3 події/кадр': async () => {
    const box = await owner.page.locator('.board-canvas').boundingBox();
    const line = await centerOf(owner, 'c1');
    await owner.page.mouse.click(box.x + line.x, box.y + line.y);
    await owner.page.waitForTimeout(300);
    const handle = await owner.page.evaluate(() => {
      const circles = window.Konva.stages[0].find('Circle').filter((n) => n.draggable() && n.isVisible());
      const r = circles[circles.length - 1].getClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    return { r: await gesture(owner, handle, { x: handle.x + 200, y: handle.y + 150 }, 3), ids: ['c1'] };
  },
  'ресайз трансформером, 3 події/кадр': async () => {
    const box = await owner.page.locator('.board-canvas').boundingBox();
    const c = await centerOf(owner, 's3');
    await owner.page.mouse.click(box.x + c.x, box.y + c.y);
    await owner.page.waitForTimeout(300);
    const h = await owner.page.evaluate(() => {
      const p = window.Konva.stages[0].findOne('Transformer').findOne('.bottom-right').getAbsolutePosition();
      return { x: p.x, y: p.y };
    });
    return { r: await gesture(owner, h, { x: h.x + 120, y: h.y + 90 }, 3), ids: ['s3'] };
  },
};

async function selectAll() {
  const box = await owner.page.locator('.board-canvas').boundingBox();
  const a = await centerOf(owner, 's1');
  const z = await centerOf(owner, 's3');
  await owner.page.mouse.move(box.x + a.x - 120, box.y + a.y - 110);
  await owner.page.mouse.down();
  await owner.page.mouse.move(box.x + z.x + 120, box.y + z.y + 100, { steps: 8 });
  await owner.page.mouse.up();
  await owner.page.waitForTimeout(300);
}

const rows = [];
for (const [name, run] of Object.entries(scenarios)) {
  const finals = {};
  for (const strategy of STRATEGIES) {
    await setServerStrategy(strategy);
    const boardId = await boardWith(owner, [peer], objects);
    await openBoard(owner, boardId, strategy);
    await openBoard(peer, boardId, strategy);
    await resetCounters(owner);
    await resetCounters(peer);
    const { r, ids } = await run();
    const out = await contentFrames(owner, 'out');
    const inn = await contentFrames(peer, 'in');
    const mine = await storeState(owner, ids);
    const theirs = await storeState(peer, ids);
    finals[strategy] = mine;
    const row = { scenario: name, strategy, frames: r.frames, out, in: inn, sameAsPeer: mine === theirs };
    rows.push(row);
    console.log(
      `${name.padEnd(34)} ${strategy.padEnd(9)} кадрів жесту ${String(r.frames).padStart(2)} | вих ${String(out.n).padStart(3)} пак ${String(out.bytes).padStart(6)} Б | сусід ${String(inn.n).padStart(3)} пак ${String(inn.bytes).padStart(6)} Б | ${row.sameAsPeer ? 'стан = у сусіда' : 'РОЗБІЖНІСТЬ'}`,
    );
    await deleteBoard(owner, boardId);
  }
  const values = Object.values(finals);
  console.log(
    `   кінцевий стан однаковий у всіх стратегіях: ${values.every((v) => v === values[0]) ? 'так' : 'НІ'}`,
  );
}

console.log('результат:', saveResults('strategies', { rows }));
await close();
