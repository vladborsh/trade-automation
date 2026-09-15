const { chromium } = require('/Users/Vladyslav_Borsh/Documents/trade_automation/node_modules/playwright');

async function drag(page, box, from, to) {
  await page.mouse.move(box.x + box.width * from, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height - 10, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('[PAGEERROR]', err.message));

  await page.goto('http://localhost:4200/');
  await page.waitForSelector('app-chart-panel', { timeout: 15000 });
  const panels = await page.locator('app-chart-panel').all();
  const c0 = panels[0].locator('.chart-container');
  const c1 = panels[1].locator('.chart-container');
  await c0.waitFor();
  await page.waitForFunction((el) => el.getAttribute('data-visible-from') !== null, await c0.elementHandle(), { timeout: 15000 });
  await page.waitForTimeout(500);

  console.log('--- panel0 first drag ---');
  console.log('before', await c0.getAttribute('data-visible-from'));
  await drag(page, await c0.boundingBox(), 0.3, 0.95);
  console.log('after ', await c0.getAttribute('data-visible-from'));

  console.log('--- panel1 (untouched) first drag, right after panel0 was dragged once ---');
  console.log('before', await c1.getAttribute('data-visible-from'));
  await drag(page, await c1.boundingBox(), 0.3, 0.95);
  console.log('after ', await c1.getAttribute('data-visible-from'));

  console.log('--- panel1 second drag ---');
  await drag(page, await c1.boundingBox(), 0.3, 0.95);
  console.log('after ', await c1.getAttribute('data-visible-from'));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
