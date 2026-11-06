import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import recorded from './fixtures/instrument-btcusdt.json';

/**
 * IB-129 (alerts design §5) — the liquidation and funding alert marks and the PMH/PML, WO and MO lines on the
 * instrument page, in a real browser. The page is the IB-099 recording (BTCUSDT 1m, 2026-11-02/03, clock fixed);
 * its 1d read now starts on 1 October, so October is complete and PMH/PML exist. The box had no live alert row
 * in that window, so the marks here are SYNTHETIC — two marks inside the window, shaped by the contract —
 * answered in place of the recorded empty list.
 *
 * What is measured is what the CHART holds (the markers plugin, the series), read through Angular's dev-mode
 * handle, not a DOM node a switch could hide. `IB129_SHOTS` = a directory: the 1240 and 390 screenshots go there too.
 */
const responses = recorded.responses as Record<string, { status: number; body: unknown }>;
const WINDOW_TO_SEC = recorded.fixedTimeMs / 1000;
const MARKS = [
  { type: 'liq', at: WINDOW_TO_SEC - 6 * 3_600 + 37, side: 'long', sumUsd: 7_400_000, thresholdUsd: 5_000_000, byVenue: { binance: 3_100_000, bybit: 2_900_000, okx: 1_400_000 } },
  { type: 'funding', event: 'enter', at: WINDOW_TO_SEC - 3 * 3_600, side: 'high', ratePer8h: 0.0008, episodeHours: null },
];

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    if (path === '/series/alert-marks') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ symbol: 'BTCUSDT', marks: MARKS, truncated: false }) });
    }
    const hit = responses[path + u.search];
    return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: u.pathname }) });
  });
  await page.goto('/instrument/BTCUSDT');
  await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
}

/** The markers on the candles and the price pane's line titles, as the chart holds them. */
async function chart(page: Page): Promise<{ markers: Array<{ position: string; text: string }>; titles: string[] }> {
  return page.evaluate(() => {
    const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
    const c = ng.getComponent(document.querySelector('app-instrument-chart')!) as {
      chart: { panes(): Array<{ getSeries(): Array<{ options(): { title?: string } }> }> };
      renderers: { alertMarkers: { markers(): Array<{ position: string; text: string }> } | null };
    };
    return {
      markers: (c.renderers.alertMarkers?.markers() ?? []).map((m) => ({ position: m.position, text: m.text })),
      titles: c.chart.panes()[0].getSeries().map((s) => s.options().title ?? '').filter((t) => t !== ''),
    };
  });
}

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const body = await page.locator('.chart-column').screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env['IB129_SHOTS'];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.locator('.chart-column').screenshot({ path: join(dir, name) });
  }
}

const layer = (page: Page, key: string) => page.locator(`.pane-legend[data-pane="price"] button[data-layer="${key}"]`);

for (const [label, use] of [
  ['desktop 1240', { viewport: { width: 1240, height: 1000 } }],
  ['phone 390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
] as const) {
  test.describe(`IB-129 alert marks and month/open lines — ${label}`, () => {
    test.use(use);

    test('the marks and the new lines are drawn; each switch hides its own kind only, and a reload keeps it', async ({ page }, info) => {
      await open(page);
      const before = await chart(page);
      expect(before.markers).toEqual([
        { position: 'belowBar', text: '$7.4M' }, // longs liquidated
        { position: 'aboveBar', text: '+0.080%' }, // longs pay
      ]);
      for (const t of ['PMH', 'PML', 'WO', 'MO', 'PWH', 'PDH']) expect(before.titles).toContain(t);
      for (const key of ['liqAlerts', 'fundingAlerts', 'prevMonth', 'weekOpen', 'monthOpen']) {
        await expect(layer(page, key)).toHaveAttribute('aria-pressed', 'true');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(use.viewport.width);
      await shot(page, info, `instrument-alert-marks-${use.viewport.width}.png`);

      await layer(page, 'liqAlerts').click();
      await expect(layer(page, 'liqAlerts')).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(async () => (await chart(page)).markers.map((m) => m.text)).toEqual(['+0.080%']);
      await layer(page, 'prevMonth').click();
      await expect.poll(async () => (await chart(page)).titles.filter((t) => t === 'PMH' || t === 'PML')).toEqual([]);
      const after = await chart(page);
      for (const t of ['WO', 'MO', 'PWH']) expect(after.titles).toContain(t); // the others stay

      await page.reload();
      await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
      await expect(layer(page, 'liqAlerts')).toHaveAttribute('aria-pressed', 'false');
      await expect(layer(page, 'prevMonth')).toHaveAttribute('aria-pressed', 'false');
      await expect.poll(async () => (await chart(page)).markers.map((m) => m.text)).toEqual(['+0.080%']);
      expect((await chart(page)).titles).not.toContain('PMH');
    });
  });
}
