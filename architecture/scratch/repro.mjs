import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const candleReqs = [];
page.on('request', (req) => {
  if (req.url().includes('/api/candles')) {
    candleReqs.push({ t: Date.now(), url: req.url() });
  }
});
page.on('console', (msg) => {
  const txt = msg.text();
  if (txt.includes('[LOADOLDER-DEBUG]')) {
    console.log('CONSOLE:', txt);
  }
});

await page.goto('http://localhost:4200');
await page.waitForSelector('app-chart-panel', { timeout: 15000 });
await page.waitForTimeout(3000);

console.log('--- after initial load, candle requests so far:', candleReqs.length);
for (const r of candleReqs) console.log(r.url);

const btcPanel = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');
const box = await btcPanel.boundingBox();
console.log('btc box:', box);

const before = await btcPanel.getAttribute('data-visible-from');
console.log('btc visible-from before drags:', before);

for (let i = 0; i < 15; i++) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const from = await btcPanel.getAttribute('data-visible-from');
  console.log(`drag ${i}: visible-from=${from}, candle reqs so far=${candleReqs.length}`);
}

console.log('--- final candle requests:');
for (const r of candleReqs) console.log(new Date(r.t).toISOString(), r.url);

await browser.close();
