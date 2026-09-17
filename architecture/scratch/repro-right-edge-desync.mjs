import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
await page.goto('http://localhost:4200');
await page.waitForSelector('app-chart-panel', { timeout: 15000 });
await page.waitForTimeout(4000);
const ids = ['btc', 'eth', 'btc-oi', 'dxy'];
const dump = async (label) => {
  const out = [];
  for (const id of ids) {
    const c = page.locator(`.chart-panel[data-panel-id="${id}"] .chart-container`);
    out.push(`${id}: from=${await c.getAttribute('data-visible-from')} to=${await c.getAttribute('data-visible-to')}`);
  }
  console.log(label, out.join(' | '));
};
await dump('BEFORE');
await page.screenshot({ path: '/tmp/bug3-before.png' });
const btc = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');
const box = await btc.boundingBox();
// pan the plot body right-to-left: reveals empty future space at the right edge of the driver
for (let i = 0; i < 3; i++) {
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1000);
await dump('AFTER');
await page.screenshot({ path: '/tmp/bug3-after.png' });
await browser.close();
