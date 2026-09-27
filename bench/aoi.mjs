// область інтересу: велика дошка, люди дивляться в різні далекі місця. хто
// скільки вмісту отримує, коли правлять не в його ділянці — стратегії 1/2
// шлють усе всім, 3 має слати лише тим, хто дивиться туди ж
import {
  boardWith,
  CELL,
  centerOf,
  close,
  contentFrames,
  deleteBoard,
  gesture,
  launch,
  newUser,
  openBoard,
  panTo,
  resetCounters,
  saveResults,
  snapshotOf,
  sticky,
} from './lib.mjs';

const STRATEGIES = (process.env.BENCH_STRATEGIES ?? 'per-event,batched,aoi').split(',');

// пʼять ділянок далеко одна від одної — кожна у своїй клітинці сітки
const REGIONS = {
  A: [300, 300],
  B: [5 * CELL + 300, 5 * CELL + 300],
  C: [5 * CELL + 300, 300],
  D: [300, 5 * CELL + 300],
};
const objects = Object.entries(REGIONS).flatMap(([r, [x, y]], i) => [
  sticky(`${r}1`, x, y, i * 2),
  sticky(`${r}2`, x + 400, y + 200, i * 2 + 1),
]);

await launch();
// A і A2 дивляться в ділянку A, B — у B, C — у C
const users = {
  A: await newUser('a'),
  A2: await newUser('a2'),
  B: await newUser('b'),
  C: await newUser('c'),
};
const look = { A: 'A', A2: 'A', B: 'B', C: 'C' };

const visibleIds = (user) =>
  user.page.evaluate(() =>
    window.Konva.stages[0]
      .find('Group')
      .map((n) => n.id())
      .filter((i) => /^[A-D]\d$/.test(i))
      .sort(),
  );
const xOf = (user, id) =>
  user.page.evaluate((id) => {
    const n = window.Konva.stages[0].findOne('#' + id);
    return n ? Math.round(n.x()) : null;
  }, id);

const results = [];
for (const strategy of STRATEGIES) {
  const boardId = await boardWith(users.A, [users.A2, users.B, users.C], objects, 'Область інтересу');
  for (const [name, user] of Object.entries(users)) {
    await openBoard(user, boardId, strategy);
    const [x, y] = REGIONS[look[name]];
    await panTo(user, x + 250, y + 150);
  }
  const loaded = {};
  for (const [name, user] of Object.entries(users)) loaded[name] = (await visibleIds(user)).length;

  // кожен по черзі тягне обʼєкт у своїй ділянці; рахуємо, хто скільки отримав
  const received = Object.fromEntries(Object.keys(users).map((k) => [k, { n: 0, bytes: 0 }]));
  for (const [name, user] of Object.entries(users)) {
    if (name === 'A2') continue;
    for (const u of Object.values(users)) await resetCounters(u);
    const id = `${look[name]}1`;
    const c = await centerOf(user, id);
    await gesture(user, c, { x: c.x + 150, y: c.y + 90 }, 1);
    for (const [other, u] of Object.entries(users)) {
      if (other === name) continue;
      const f = await contentFrames(u, 'in');
      received[other].n += f.n;
      received[other].bytes += f.bytes;
    }
  }

  // правка в A: хто її отримав
  for (const u of Object.values(users)) await resetCounters(u);
  const c = await centerOf(users.A, 'A2');
  await gesture(users.A, c, { x: c.x - 120, y: c.y + 60 }, 1);
  const editA = {};
  for (const name of ['A2', 'B', 'C']) editA[name] = await contentFrames(users[name], 'in');
  const aX = await xOf(users.A, 'A2');
  const a2Sees = await xOf(users.A2, 'A2');

  // B переїжджає в A: має наздогнати, а потім, повернувшись, перестати отримувати
  await panTo(users.B, REGIONS.A[0] + 250, REGIONS.A[1] + 150);
  const bCaughtUp = (await xOf(users.B, 'A2')) === aX;
  await panTo(users.B, REGIONS.B[0] + 250, REGIONS.B[1] + 150);
  for (const u of Object.values(users)) await resetCounters(u);
  const c2 = await centerOf(users.A, 'A1');
  await gesture(users.A, c2, { x: c2.x + 100, y: c2.y }, 1);
  const bAfterLeaving = await contentFrames(users.B, 'in');

  await users.A.page.waitForTimeout(3500);
  const snap = await snapshotOf(users.A, boardId);

  const row = {
    strategy,
    loaded,
    receivedWhileOthersEdit: received,
    editInA: editA,
    a2SeesLive: a2Sees === aX,
    bCaughtUp,
    bAfterLeavingA: bAfterLeaving,
    snapshotObjects: snap.objects.length,
  };
  results.push(row);
  console.log(`\n== ${strategy}`);
  console.log('  завантажено обʼєктів:', JSON.stringify(loaded));
  console.log('  отримано вмісту, поки троє інших правили свої ділянки:');
  for (const [k, v] of Object.entries(received))
    console.log(`    ${k.padEnd(3)} ${String(v.n).padStart(3)} пак ${String(v.bytes).padStart(6)} Б`);
  console.log(
    `  правка в A: A2 ${editA.A2.n} пак, B ${editA.B.n} пак, C ${editA.C.n} пак; A2 бачить наживо: ${row.a2SeesLive}`,
  );
  console.log(`  B перейшов у A і наздогнав: ${bCaughtUp}; повернувся — отримав з A ${bAfterLeaving.n} пак`);
  console.log(`  у базі обʼєктів: ${snap.objects.length} з ${objects.length}`);
  await deleteBoard(users.A, boardId);
}

console.log('\nрезультат:', saveResults('aoi', { cellSize: CELL, regions: REGIONS, results }));
await close();
