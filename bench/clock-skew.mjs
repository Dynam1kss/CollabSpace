// калібрування: наскільки розходяться годинники вкладок. затримку міряємо між
// різними процесами через performance.timeOrigin + performance.now(), і цей
// розхід — межа точності самого методу (журнал 29.09)
import { close, launch, newUsers } from './lib.mjs';

await launch(['--disable-gpu', '--no-sandbox']);
const users = await newUsers(
  Array.from({ length: 6 }, (_, i) => `clk${i}`),
  { width: 800, height: 540 },
  6,
);
// в одному обчисленні беремо обидва годинники: різниця показує, наскільки
// шкала вкладки зʼїхала відносно спільного системного часу
const skews = [];
for (let round = 0; round < 5; round++) {
  for (const u of users) {
    const d = await u.page.evaluate(() => performance.timeOrigin + performance.now() - Date.now());
    skews.push(d);
  }
}
const sorted = [...skews].sort((a, b) => a - b);
console.log(`проб ${skews.length}`);
console.log(`мін ${sorted[0].toFixed(1)} мс, макс ${sorted[sorted.length - 1].toFixed(1)} мс`);
console.log(`розмах між вкладками ${(sorted[sorted.length - 1] - sorted[0]).toFixed(1)} мс`);
await close();
