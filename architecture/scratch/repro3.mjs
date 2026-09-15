import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

const reqs = [];
page.on('request', (req) => {
  if (req.url().includes('/api/candles')) reqs.push({ t: Date.now(), url: req.url() });
});
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('LOADOLDER-DEBUG') && t.includes('btc ')) console.log('CONSOLE:', t);
  if (t.includes('EMIT') || t.includes('panel-feed')) console.log('CONSOLE:', t);
});

await page.goto('http://localhost:4200');
await page.waitForSelector('app-chart-panel', { timeout: 15000 });
await page.waitForTimeout(3000);
console.log('=== initial candle reqs:', reqs.length);

const btcPanel = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');

// Drag inside the PLOT area (mid-height), not the time-axis strip, to test PAN vs ZOOM.
for (let i = 0; i < 20; i++) {
  const box = await btcPanel.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const from = await btcPanel.getAttribute('data-visible-from');
  console.log(`=== pan ${i} done: visible-from=${from}, candleReqs=${reqs.length}`);
}
for (const r of reqs) console.log(new Date(r.t).toISOString(), r.url);
await browser.close();
