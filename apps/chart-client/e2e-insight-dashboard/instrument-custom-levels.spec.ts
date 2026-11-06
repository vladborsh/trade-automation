import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import recorded from './fixtures/instrument-btcusdt.json';
// IB-128: slot dev-3's real `/series/custom-levels?symbol=BTCUSDT` answer (2026-11-06). Its one level (75 676, the
// price at the time) lies under the recording's range (76 351 … 77 857), so its PRICE is moved into it below.
import customLevels from './fixtures/series-custom-levels-btcusdt.json';

/**
 * IB-128 (alerts design §4 P9, §5) — an admin's custom levels on the instrument page, in a real browser: the IB-099
 * recording (BTCUSDT 1m), signed in as an ADMIN (the recording's `/auth/me` is a member, who never asks for them).
 * Measured on the chart itself (the price series' price lines, through Angular's dev-mode handle). `IB128_SHOTS` = a
 * directory: the 1240 and 390 screenshots go there too.
 */
const responses = recorded.responses as Record<string, { status: number; body: unknown }>;
const LEVELS = { ...customLevels, levels: [{ ...customLevels.levels[0], price: 77_000 }, { id: 4, price: 77_500, note: null }] };

async function open(page: Page, admin = true): Promise<string[]> {
  const asked: string[] = [];
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    if (path === '/auth/me' && admin) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 2, tgUserId: 111, role: 'admin', lang: 'en', login: 'owner' } }) });
    }
    if (path === '/series/custom-levels') {
      asked.push(u.search);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEVELS) });
    }
    const hit = responses[path + u.search];
    return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: u.pathname }) });
  });
  await page.goto('/instrument/BTCUSDT');
  await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
  return asked;
}

/** The candle series' price lines as the chart holds them. */
async function lines(page: Page): Promise<Array<{ price: number; title: string }>> {
  return page.evaluate(() => {
    const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
    const c = ng.getComponent(document.querySelector('app-instrument-chart')!) as {
      chart: { panes(): Array<{ getSeries(): Array<{ seriesType(): string; priceLines(): Array<{ options(): { price: number; title: string } }> }> }> };
    };
    const candles = c.chart.panes()[0].getSeries().find((s) => s.seriesType() === 'Candlestick')!;
    return candles.priceLines().map((l) => ({ price: l.options().price, title: l.options().title }));
  });
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await info.attach(name, { body: await page.locator('.chart-column').screenshot(), contentType: 'image/png' });
  const dir = process.env['IB128_SHOTS'];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.locator('.chart-column').screenshot({ path: join(dir, name) });
  }
}

const layer = (page: Page) => page.locator('.pane-legend[data-pane="price"] button[data-layer="customLevels"]');

test.describe('IB-128 custom levels on the chart — desktop 1240', () => {
  test.use({ viewport: { width: 1240, height: 1000 } });

  test('an admin\'s levels are price lines titled with id and note; their switch hides them only; a reload keeps it', async ({ page }, info) => {
    const asked = await open(page);
    expect(asked).toEqual(['?symbol=BTCUSDT']);
    await expect.poll(() => lines(page)).toEqual([{ price: 77_000, title: '#1 slot test: at the pr…' } /* cut at 24 on the axis */, { price: 77_500, title: '#4' }]);
    await expect(layer(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(layer(page)).toHaveText('Custom levels');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1240);
    await shot(page, info, 'instrument-custom-levels-1240.png');

    await layer(page).click();
    await expect(layer(page)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => lines(page)).toEqual([]);
    for (const key of ['prevMonth', 'weekOpen', 'monthOpen']) {
      await expect(page.locator(`.pane-legend[data-pane="price"] button[data-layer="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
    }
    await page.reload();
    await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
    await expect(layer(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await lines(page)).toEqual([]);
    await layer(page).click();
    await expect.poll(async () => (await lines(page)).length).toBe(2);
  });

  test('a member\'s page never asks for them and has no switch', async ({ page }) => {
    const asked = await open(page, false);
    expect(asked).toEqual([]);
    await expect(layer(page)).toHaveCount(0);
    expect(await lines(page)).toEqual([]);
  });
});

test.describe('IB-128 custom levels on the chart — phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the switch sits in the «Layers» fold with the others; the lines are drawn whatever the fold', async ({ page }, info) => {
    await open(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
    const fold = page.locator('.pane-legend[data-pane="price"] .layers-fold');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(layer(page)).toBeHidden();
    await expect.poll(async () => (await lines(page)).length).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await shot(page, info, 'instrument-custom-levels-390.png');
    await fold.tap();
    await expect(layer(page)).toBeVisible();
    expect((await layer(page).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await shot(page, info, 'instrument-custom-levels-390-open.png');
    await layer(page).tap();
    await expect.poll(() => lines(page)).toEqual([]);
  });
});
