import { test, expect, type Page } from '@playwright/test';

/**
 * architecture/aggregate-oi.md §1 "What the reader sees", against the mock's scripted 3-venue
 * scenario (mock-server/aggregate-oi.ts: Bybit only > 30 d, + Binance, + Hyperliquid for the last
 * 2 d, a 1-hour Hyperliquid outage 20 h ago, a dropped 2-slot blip 8 h ago, a live forming bucket).
 *
 * MOCK_API_PORT points this spec at a worktree's own mock server (default :4300).
 * AGG_SCREENSHOT overrides where the 15m three-epoch screenshot is written.
 */
const MOCK_PORT = process.env['MOCK_API_PORT'] ?? '4300';
const API = `http://localhost:${MOCK_PORT}/api`;
const WS = `ws://localhost:${MOCK_PORT}/ws`;
const SCREENSHOT = process.env['AGG_SCREENSHOT'] ?? 'test-results/aggregate-oi-15m.png';
const DAY_MS = 86_400_000;

interface Marker {
  time: number;
  text: string;
}
interface AggPoint {
  time: number;
  coverage: string[];
}

async function openOnMock(page: Page): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: API, wsUrl: WS }) }),
  );
  await page.goto('/');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });
}

const oiPanel = (page: Page) => page.locator('.chart-panel[data-panel-id="btc-oi"]');
const oiChart = (page: Page) => oiPanel(page).locator('.chart-container');

/** Switches timeframe and waits until THIS timeframe's aggregate page is loaded and drawn. */
async function pickTimeframe(page: Page, tf: string): Promise<void> {
  const loaded = page.waitForResponse((r) => r.url().includes('/metric-aggregates/points') && r.url().includes(`timeframe=${tf}&`));
  await page.getByRole('button', { name: tf, exact: true }).click();
  await loaded;
  await expect(oiPanel(page).locator('.panel-body')).toHaveAttribute('data-metric-style', tf === '1m' ? 'line' : 'candles');
  await expect.poll(async () => (await markersOf(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300); // one more frame: the shared range is re-joined after setData
}

async function markersOf(page: Page): Promise<Marker[]> {
  return JSON.parse((await oiChart(page).getAttribute('data-seam-markers')) ?? '[]') as Marker[];
}

/** Every coverage change in the whole REST series, with the text §1 point 2 says it must carry. */
async function expectedSeams(page: Page, tf: string): Promise<Marker[]> {
  const now = Date.now();
  const res = await page.request.get(`${API}/metric-aggregates/points`, {
    params: { aggregate: 'btc-perp-oi', timeframe: tf, from: now - 50 * DAY_MS, to: now, limit: 5000 },
  });
  const points = ((await res.json()) as { points: AggPoint[] }).points;
  const name = (id: string) => ({ binance: 'Binance', bybit: 'Bybit', hyperliquid: 'Hyperliquid' })[id.split(':')[0]]!;
  const seams: Marker[] = [];
  for (let i = 1; i < points.length; i++) {
    const [prev, cur] = [points[i - 1].coverage, points[i].coverage];
    const added = cur.filter((m) => !prev.includes(m)).map((m) => `+${name(m)}`);
    const removed = prev.filter((m) => !cur.includes(m)).map((m) => `−${name(m)}`);
    if (added.length + removed.length > 0) seams.push({ time: points[i].time, text: [...added, ...removed].join(' ') });
  }
  return seams;
}

test('header: aggregate title in USD, one-sided badge, chip on the last bar', async ({ page }) => {
  await openOnMock(page);
  await expect(oiPanel(page).locator('.panel-title')).toHaveText('BTC perps · 3 venues · Open interest · USD', {
    timeout: 15_000,
  });
  const badge = oiPanel(page).getByTestId('convention-badge');
  await expect(badge).toHaveText('one-sided');
  await expect(badge).toHaveAttribute('title', /16 %/);
  const chip = oiPanel(page).getByTestId('coverage-chip');
  await expect(chip).toHaveText('3/3 · Binance · Bybit · Hyperliquid');
  await expect(chip).toHaveAttribute('title', /Hyperliquid: \$[\d.]+[KMB] · [\d.]+ %/);
});

test('the chip follows the crosshair: partial bar vs complete bar', async ({ page }) => {
  await openOnMock(page);
  await pickTimeframe(page, '1h'); // 2 d of complete bars and the partial epoch before it both on screen
  const chip = oiPanel(page).getByTestId('coverage-chip');
  const box = (await oiChart(page).boundingBox())!;
  // The synced window depends on the candle panels; zoom out (anchored at the tip) until the
  // −2 d `+Hyperliquid` seam is well inside it, so partial bars are on screen whatever it was.
  await expect(async () => {
    await page.mouse.move(box.x + box.width - 90, box.y + box.height * 0.5);
    await page.mouse.wheel(0, 300);
    const from = Number(await oiChart(page).getAttribute('data-visible-from'));
    expect(from * 1000).toBeLessThan(Date.now() - 3 * DAY_MS);
  }).toPass({ timeout: 15_000 });
  const seen = new Map<string, { muted: boolean; tooltip: string }>(); // chip text → how it looked
  for (let x = box.width - 70; x > 10; x -= 8) {
    await page.mouse.move(box.x + x, box.y + box.height * 0.5);
    const text = (await chip.textContent())!.trim();
    if (!seen.has(text)) {
      const muted = await chip.evaluate((el) => el.classList.contains('partial'));
      seen.set(text, { muted, tooltip: (await chip.getAttribute('title')) ?? '' });
    }
  }
  const all = JSON.stringify([...seen.keys()]);
  expect(seen.get('3/3 · Binance · Bybit · Hyperliquid')?.muted, all).toBe(false);
  const partial = seen.get('2/3 · Binance · Bybit — без Hyperliquid');
  expect(partial?.muted, all).toBe(true);
  expect(partial?.tooltip).toContain('Hyperliquid: нет в этой свече');

  await page.mouse.move(0, 0); // leave: back to the last bar
  await expect(chip).toHaveText('3/3 · Binance · Bybit · Hyperliquid');
});

test('a seam marker on every coverage change in the loaded range (15m)', async ({ page }) => {
  await openOnMock(page);
  await pickTimeframe(page, '15m');
  const expected = await expectedSeams(page, '15m');
  const markers = await markersOf(page);
  // Nothing marked that is not a coverage change, with the right text…
  for (const m of markers) expect(expected).toContainEqual(m);
  // …and every change of the last 15 days (inside the first 1500-bar page) is marked.
  const recent = expected.filter((s) => s.time > Date.now() - 15 * DAY_MS);
  expect(recent.map((s) => s.text)).toEqual(['+Hyperliquid', '−Hyperliquid', '+Hyperliquid']);
  for (const s of recent) expect(markers).toContainEqual(s);
});

test('the 1m line breaks at every seam', async ({ page }) => {
  await openOnMock(page);
  await pickTimeframe(page, '1m');
  const markers = await markersOf(page);
  expect(markers.length).toBeGreaterThanOrEqual(3);
  const breaks = JSON.parse((await oiChart(page).getAttribute('data-line-breaks'))!) as number[];
  for (const m of markers) expect(breaks).toContain(m.time);
});

test('15m, zoomed out: all three epochs and every seam on one screen (screenshot)', async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 900 });
  await openOnMock(page);
  for (const id of ['btc', 'eth', 'dxy']) {
    await page.locator(`.chart-panel[data-panel-id="${id}"] .collapse-btn`).click();
  }
  await expect(page.locator('app-chart-panel')).toHaveCount(1);
  await pickTimeframe(page, '15m');

  const box = (await oiChart(page).boundingBox())!;
  const oldest = Date.now() - 40 * DAY_MS;
  await expect(async () => {
    // Zoom out anchored at the last bar (wheel zoom keeps the cursor's bar fixed), so the view grows
    // to the left into older history — which pages it in — instead of into the void past the tip.
    await page.mouse.move(box.x + box.width - 90, box.y + box.height * 0.5);
    await page.mouse.wheel(0, 600);
    const from = Number(await oiChart(page).getAttribute('data-visible-from'));
    expect(from * 1000).toBeLessThan(oldest);
  }).toPass({ timeout: 30_000 });
  await page.mouse.move(0, 0);

  const markers = await markersOf(page);
  expect(markers.map((m) => m.text)).toEqual(['+Binance', '+Hyperliquid', '−Hyperliquid', '+Hyperliquid']);
  await oiPanel(page).screenshot({ path: SCREENSHOT });
});
