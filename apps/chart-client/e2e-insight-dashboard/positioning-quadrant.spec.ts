import { expect, test, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import positioning from './fixtures/market-positioning.24h.json';

/**
 * IB-137 (market round 3 §2) — the «Цена × OI» quadrant's views, zoom, pan and click, in a real
 * browser at 1240 and 390.
 *
 * The data is the captured positioning answer (dev-3, 2026-11-03) with ONE edit, test data and not a
 * capture: TRUMP moved to +38 % price / +12 % OI, the owner's outlier (feedback-3 §2). Touch is real
 * input through CDP (`Input.synthesizeScrollGesture` for a swipe, `Input.dispatchTouchEvent` for two
 * fingers), so `touch-action` is the browser's to honour, not ours to fake.
 */
const MEMBER = { user: { id: 1, tgUserId: 111, role: 'member', lang: 'en', login: 'e2e' } };
const OUTLIER = 'TRUMP +38 % / +12 %';
const rows = positioning.rows.map((r) => r.symbol !== 'TRUMPUSDT' ? r : {
  ...r, priceChangePct: { ...r.priceChangePct, value: 38 }, oiChangePct: { ...r.oiChangePct, value: 12 },
});
const answer = { ...positioning, rows };

async function open(page: Page): Promise<void> {
  await page.clock.install({ time: positioning.asOf * 1000 + 30_000 });
  await page.route('**/api/web/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/web', '');
    const body: Record<string, unknown> = { '/auth/me': MEMBER, '/market/positioning': answer };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
  await page.goto('/positioning?p=24h');
  await page.clock.runFor(2_000);
  await expect(page.locator('app-pos-quadrant g.dot').first()).toBeAttached();
}

async function shot(info: TestInfo, name: string, body: Buffer): Promise<void> {
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env['E2E_SHOTS']) (await import('node:fs')).writeFileSync(`${process.env['E2E_SHOTS']}/${name}`, body);
}

const q = (page: Page) => page.locator('app-pos-quadrant');
const pressed = (page: Page, cls: 'bulk' | 'full') => q(page).locator(`button.${cls}`);
/** The right end of the price axis, as printed — moves with every zoom and pan. */
const xMaxTick = (page: Page) => q(page).locator('text.tick').first().textContent();
const settle = (page: Page) => page.clock.runFor(100);

async function plotCentre(page: Page): Promise<{ x: number; y: number }> {
  const b = (await q(page).locator('.plot').boundingBox())!;
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
}

/** Two fingers, `from` px apart to `to` px apart, about the plot's centre. */
async function pinch(cdp: CDPSession, c: { x: number; y: number }, from: number, to: number): Promise<void> {
  const pts = (d: number) => [{ x: c.x - d / 2, y: c.y, id: 0 }, { x: c.x + d / 2, y: c.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** One finger dragging from `c` by (dx, dy), as a swipe the browser may scroll with. */
async function swipe(cdp: CDPSession, c: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await cdp.send('Input.synthesizeScrollGesture', {
    x: c.x, y: c.y, xDistance: dx, yDistance: dy, gestureSourceType: 'touch', speed: 800, preventFling: true,
  });
}

test.describe('IB-137 quadrant — phone 390×844, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('opens on «without outliers» with TRUMP pinned to the edge; «all» brings it in; + zooms (screenshots)', async ({ page }, info) => {
    await open(page);
    const chart = q(page);
    await chart.scrollIntoViewIfNeeded();
    await expect(pressed(page, 'bulk')).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator('g.dot.pinned[data-symbol="TRUMPUSDT"]')).toHaveCount(1);
    await expect(chart.locator('text.label')).toContainText([OUTLIER]);
    await expect(chart.locator('text.corner')).toHaveCount(4);
    // targets: the view buttons are ≥ 40 px tall on a phone
    for (const b of await chart.locator('.controls button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await shot(info, 'ib137-390-bulk.png', await chart.screenshot());

    await pressed(page, 'full').tap();
    await settle(page);
    await expect(pressed(page, 'full')).toHaveAttribute('aria-pressed', 'true');
    await expect(chart.locator('g.dot[data-symbol="TRUMPUSDT"]')).not.toHaveClass(/pinned/);
    await shot(info, 'ib137-390-full.png', await chart.screenshot());

    await pressed(page, 'bulk').tap();
    await chart.locator('button.zoom.in').tap();
    await chart.locator('button.zoom.in').tap();
    await settle(page);
    await expect(chart.locator('.seg button[aria-pressed="true"]')).toHaveCount(0);
    await expect(chart.locator('.plot')).toHaveCSS('touch-action', 'none');
    await shot(info, 'ib137-390-zoomed.png', await chart.screenshot());
  });

  test('unzoomed, a one-finger swipe over the chart scrolls the PAGE and leaves the view alone', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    await q(page).locator('.plot').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page);
    await expect(q(page).locator('.plot')).toHaveCSS('touch-action', 'pan-y');
    const before = await page.evaluate(() => window.scrollY);
    const tick = await xMaxTick(page);
    await swipe(cdp, await plotCentre(page), 0, -250);
    await settle(page);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before + 100);
    expect(await xMaxTick(page)).toBe(tick);
    await expect(pressed(page, 'bulk')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a pinch zooms in about the fingers; once zoomed, one finger pans the CHART and the page stays put', async ({ page }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    await q(page).locator('.plot').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page);
    const tick0 = await xMaxTick(page);
    await pinch(cdp, await plotCentre(page), 80, 200);
    await settle(page);
    const tick1 = await xMaxTick(page);
    expect(tick1).not.toBe(tick0);
    await expect(q(page).locator('.seg button[aria-pressed="true"]')).toHaveCount(0);
    await expect(q(page).locator('.plot')).toHaveCSS('touch-action', 'none');

    const y = await page.evaluate(() => window.scrollY);
    await swipe(cdp, await plotCentre(page), -120, 0);
    await settle(page);
    expect(await xMaxTick(page)).not.toBe(tick1); // dragged left → the view moved right
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
  });

  test('the first tap shows the numbers with «Open →» (R4\'s link); the link opens the coin; a tap elsewhere closes', async ({ page }) => {
    await open(page);
    const btc = q(page).locator('g.dot[data-symbol="BTCUSDT"] circle').first();
    await btc.tap();
    await settle(page);
    const tip = q(page).locator('.tip');
    await expect(tip).toContainText('BTC: price');
    const link = tip.locator('a.open');
    await expect(link).toHaveText('Open →');
    await expect(link).toHaveAttribute('href', `/instrument/BTCUSDT?at=${positioning.asOf - 86_400}&span=24h`);
    expect(page.url()).toContain('/positioning');
    // an empty spot on the left edge, between the quadrant names (any non-dot target closes)
    await q(page).locator('rect.bg').tap({ position: { x: 3, y: 60 }, force: true });
    await settle(page);
    await expect(tip).toHaveCount(0);
    await btc.tap();
    await settle(page);
    await tip.locator('a.open').tap();
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`/instrument/BTCUSDT\\?at=${positioning.asOf - 86_400}&span=24h`));
  });
});

test.describe('IB-137 quadrant — desktop 1240×900, mouse', () => {
  test.use({ viewport: { width: 1240, height: 900 } });

  test('the three views (screenshots), and the wheel zooms only over the chart', async ({ page }, info) => {
    await open(page);
    const chart = q(page);
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator('text.label')).toContainText([OUTLIER]);
    await shot(info, 'ib137-1240-bulk.png', await chart.screenshot());
    await pressed(page, 'full').click();
    await settle(page);
    await shot(info, 'ib137-1240-full.png', await chart.screenshot());
    await pressed(page, 'bulk').click();
    await settle(page);

    // the wheel over the heading (outside the plot) scrolls the page and leaves the view alone
    const tick0 = await xMaxTick(page);
    const head = (await page.locator('app-positioning-page h1, app-positioning-page h2').first().boundingBox())!;
    await page.mouse.move(head.x + 10, head.y + 5);
    await page.mouse.wheel(0, -300);
    await settle(page);
    expect(await xMaxTick(page)).toBe(tick0);

    const c = await plotCentre(page);
    await page.mouse.move(c.x, c.y);
    const y = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, -300);
    await settle(page);
    expect(await xMaxTick(page)).not.toBe(tick0);
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    await expect(chart.locator('.seg button[aria-pressed="true"]')).toHaveCount(0);
    await shot(info, 'ib137-1240-zoomed.png', await chart.screenshot());

    // zoomed: a mouse drag pans, and the release does not open the dot under it
    const tick1 = await xMaxTick(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 60, c.y, { steps: 6 });
    await page.mouse.move(c.x - 120, c.y, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    expect(await xMaxTick(page)).not.toBe(tick1);
    expect(page.url()).toContain('/positioning');
  });

  test('hover shows the numbers without a link; one click opens the coin', async ({ page }) => {
    await open(page);
    const sol = q(page).locator('g.dot[data-symbol="SOLUSDT"]');
    await sol.hover();
    await settle(page);
    await expect(q(page).locator('.tip')).toContainText('SOL: price');
    await expect(q(page).locator('.tip a')).toHaveCount(0);
    await sol.click();
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`/instrument/SOLUSDT\\?at=${positioning.asOf - 86_400}&span=24h`));
  });

  test('keyboard: Tab reaches the dots, focus shows the numbers, Enter opens', async ({ page }) => {
    await open(page);
    await q(page).locator('button.zoom.in').focus();
    await page.keyboard.press('Tab');
    await settle(page);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-symbol'));
    expect(focused).toBeTruthy();
    await expect(q(page).locator('.tip')).toBeVisible();
    await page.keyboard.press('Enter');
    await settle(page);
    await expect(page).toHaveURL(new RegExp(`/instrument/${focused}\\?`));
  });
});
