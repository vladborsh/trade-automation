import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const reqs = [];
page.on('request', (req) => {
  if (req.url().includes('/api/candles') || req.url().includes('/api/metrics')) {
    reqs.push({ t: Date.now(), url: req.url() });
  }
});
page.on('console', (msg) => {
  console.log('CONSOLE:', msg.type(), msg.text());
});
page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));

await page.goto('http://localhost:4200');
await page.waitForSelector('app-chart-panel', { timeout: 15000 });
await page.waitForTimeout(3000);
console.log('=== initial reqs:', reqs.length);

const btcPanel = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');

for (let i = 0; i < 8; i++) {
  const box = await btcPanel.boundingBox();
  console.log(`drag ${i} box:`, JSON.stringify(box));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const from = await btcPanel.getAttribute('data-visible-from');
  console.log(`=== drag ${i} done: visible-from=${from}, reqs=${reqs.length}`);
}

for (const r of reqs) console.log(new Date(r.t).toISOString(), r.url);

await browser.close();
