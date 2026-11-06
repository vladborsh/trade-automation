import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  foldProfile, groupRows, profileGrid, type LiqProfilePrint, type WebLiqProfileResponse, type WebLiqProfileVenueState,
} from '@trade-automation/contracts';
import recorded from './fixtures/instrument-btcusdt.json';
import tape from './fixtures/liq-profile-prints-btcusdt.json';
import { gotoReady } from './ready';

/**
 * IB-153 acceptance — /instrument's liquidation profile by price replaces the «50 largest» table.
 *
 * The page is IB-099's recording (BTCUSDT 1m, the clock fixed at the recording's instant). The profile's
 * request carries the chart's view, so it cannot be a recorded URL: it is answered from the box tape's raw
 * prints for that window (`liq-profile-prints-btcusdt.json`, 517 prints) with the contract's OWN grid and
 * folding — the server's twin is pinned against Postgres in the bot's DB spec.
 *
 * The alignment check reads the PIXELS the strip painted and compares them with lightweight-charts' own
 * price → y on the candles (the axis' mapping), so it can disagree with the primitive's geometry.
 * `SHOT_DIR` also writes the PNGs for the side-by-side with the mockup.
 */
const responses = recorded.responses as Record<string, { status: number; body: unknown }>;
const MEMBER = { user: { id: 1, tgUserId: 111, role: 'member', lang: 'ru', login: 'e2e' } };
const prints: Array<LiqProfilePrint & { ms: number }> = (tape.prints as Array<[number, number, 'long' | 'short', string, number]>)
  .map(([ms, price, side, venue, usd]) => ({ ms, price, side, venue, usd }));

interface Served { answers: WebLiqProfileResponse[] }

/** A profile answer as the bot builds it, from the prints in [from, to) and the span [lo, hi]. */
function profileAnswer(u: URL, okx: WebLiqProfileVenueState): WebLiqProfileResponse {
  const from = Number(u.searchParams.get('from'));
  const to = Number(u.searchParams.get('to'));
  const grid = profileGrid(Number(u.searchParams.get('lo')), Number(u.searchParams.get('hi')));
  const rows = prints.filter((p) => p.ms >= from && p.ms < to && (okx !== 'not_recorded' || p.venue !== 'okx'));
  return {
    symbol: u.searchParams.get('symbol')!, from, to, ...grid, ...foldProfile(groupRows(rows, grid.step), grid),
    venues: [{ venue: 'binance', state: 'recorded' }, { venue: 'bybit', state: 'recorded' }, { venue: 'okx', state: okx }],
    undercounted: true,
  };
}

async function open(page: Page, okx: WebLiqProfileVenueState = 'recorded'): Promise<Served> {
  const served: Served = { answers: [] };
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    if (path === '/auth/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(MEMBER) });
    if (path === '/series/liquidations/profile') {
      const answer = profileAnswer(u, okx);
      served.answers.push(answer);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) });
    }
    const hit = responses[path + u.search];
    return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: path }) });
  });
  await gotoReady(page, '/instrument/BTCUSDT', { served: ['/series/candles', '/series/liquidations/profile'], ready: page.locator('[data-liq-profile-link]') });
  await expect(page.locator('[data-liq-profile] app-loader')).toHaveCount(0);
  return served;
}

async function shoot(page: Page, info: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env['SHOT_DIR'];
  if (dir) await page.screenshot({ fullPage: true, path: `${dir}/${name}` });
}

const widths = (page: Page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

/**
 * The short bars as PAINTED: runs of bar-coloured rows in one pixel column just right of the strip's centre
 * line, read from the price pane's canvas; and, for each band edge, lightweight-charts' own y for that price.
 */
async function paintedVersusAxis(page: Page, answer: WebLiqProfileResponse) {
  return page.evaluate(({ answer }) => {
    const host = document.querySelector('app-instrument-chart .chart-host')!;
    const pane = host.querySelector('table tr')!.children[1] as HTMLElement;
    const canvas = pane.querySelector('canvas') as HTMLCanvasElement;
    const ratio = canvas.width / pane.getBoundingClientRect().width;
    const paneWidth = pane.getBoundingClientRect().width;
    const strip = Math.round(Math.min(180, Math.max(120, paneWidth * 0.2)));
    const x = Math.round((paneWidth - strip / 2 + 4) * ratio);
    const ctx = canvas.getContext('2d')!;
    const column = ctx.getImageData(x, 0, 1, canvas.height).data;
    // the short colour (#26a69a) at 70 % over anything: green well above red, and bright
    const isBar = (y: number) => { const r = column[y * 4]!; const g = column[y * 4 + 1]!; return g >= 105 && g - r >= 50; };
    const runs: Array<{ top: number; bottom: number }> = [];
    for (let y = 0; y < canvas.height; y++) {
      if (!isBar(y)) continue;
      const top = y;
      while (y + 1 < canvas.height && isBar(y + 1)) y++;
      runs.push({ top: top / ratio, bottom: (y + 1) / ratio });
    }
    const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
    const chart = ng.getComponent(document.querySelector('app-instrument-chart')!) as {
      renderers: { price: { priceToCoordinate(p: number): number | null } };
    };
    const max = Math.max(...answer.bands.map((b) => Math.max(b.long.usd, b.short.usd)));
    const bands = answer.bands
      .filter((b) => b.short.usd / max >= 0.1) // long enough to cross the sampled column
      .map((b) => ({ band: b.band, top: chart.renderers.price.priceToCoordinate((b.band + 1) * answer.step), bottom: chart.renderers.price.priceToCoordinate(b.band * answer.step) }))
      .filter((b) => b.top !== null && b.bottom !== null && b.top >= 0 && b.bottom <= canvas.height / ratio);
    return { runs, bands: bands as Array<{ band: number; top: number; bottom: number }> };
  }, { answer });
}

test.describe('instrument — liquidation profile at 1240 (IB-153)', () => {
  test.use({ viewport: { width: 1240, height: 900 } });

  test('the table is gone; the link opens the coin\'s large liquidations as a list', async ({ page }, info) => {
    await open(page);
    await expect(page.locator('table.top')).toHaveCount(0);
    await expect(page.getByText('50 крупнейших')).toHaveCount(0);
    const link = page.locator('[data-liq-profile-link]');
    await expect(link).toContainText('BTC');
    await expect(link).toHaveAttribute('href', '/liquidations?coin=BTCUSDT&view=list');
    // the phone histogram is the phone's: hidden here, the bars are on the price pane
    await expect(page.locator('[data-liq-profile-histogram]')).toBeHidden();
    await shoot(page, info, 'instrument-liq-profile-1240.png');
    await link.click();
    await expect(page).toHaveURL(/\/liquidations\?coin=BTCUSDT&view=list$/);
  });

  test('every painted band sits on the axis: its edges at lightweight-charts\' y for their prices, within 1 px', async ({ page }) => {
    const served = await open(page);
    await page.waitForTimeout(500); // the strip repaints on the answer's arrival
    const answer = served.answers.at(-1)!;
    expect(answer.bands.length).toBeGreaterThan(3);
    const { runs, bands } = await paintedVersusAxis(page, answer);
    expect(bands.length).toBeGreaterThan(2);
    for (const b of bands) {
      // a level line drawn over the strip can split one bar into two runs: the bar is the outermost of them
      const inside = runs.filter((r) => r.top < b.bottom - 1 && r.bottom > b.top + 1);
      expect(inside.length, `band ${b.band} (${b.band * answer.step}) painted`).toBeGreaterThan(0);
      const top = Math.min(...inside.map((r) => r.top));
      const bottom = Math.max(...inside.map((r) => r.bottom));
      expect(Math.abs(top - b.top), `band ${b.band} top edge`).toBeLessThanOrEqual(1);
      // the bar stops one pixel short of its low edge (the gap that keeps neighbours apart)
      expect(Math.abs(bottom - b.bottom), `band ${b.band} low edge`).toBeLessThanOrEqual(2);
    }
  });

  test('hovering a band shows its price range, the sides, the count and the venue split', async ({ page }) => {
    const served = await open(page);
    const answer = served.answers.at(-1)!;
    const biggest = [...answer.bands].sort((a, b) => b.short.usd + b.long.usd - a.short.usd - a.long.usd)[0]!;
    const y = await page.evaluate((p) => {
      const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
      const c = ng.getComponent(document.querySelector('app-instrument-chart')!) as { renderers: { price: { priceToCoordinate(p: number): number | null } } };
      return c.renderers.price.priceToCoordinate(p);
    }, (biggest.band + 0.5) * answer.step);
    const pane = page.locator('app-instrument-chart .chart-host table tr').first().locator('td').nth(1);
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + box.width - 30, box.y + y!, { steps: 4 });
    const tip = page.locator('[data-liq-profile-tip]');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(`${biggest.band * answer.step} – ${(biggest.band + 1) * answer.step}`);
    await expect(tip).toContainText(`ликвидаций: ${biggest.long.count + biggest.short.count}`);
    for (const v of biggest.venues) await expect(tip).toContainText(v.venue === 'okx' ? 'OKX' : v.venue === 'bybit' ? 'Bybit' : 'Binance');
    // the calendar tooltip of the bar under the pointer stays closed while the profile's is open
    await expect(page.locator('.calendar-tooltip')).toHaveCount(0);
  });

  test('a venue that was not listening is said as missing, not shown as $0', async ({ page }, info) => {
    await open(page, 'not_recorded');
    await expect(page.locator('[data-liq-profile-missing]')).toContainText('OKX');
    await shoot(page, info, 'instrument-liq-profile-1240-okx-missing.png');
  });
});

test.describe('instrument — liquidation profile at 390 (IB-153)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a histogram under the chart, high price on top, no page scroll sideways', async ({ page }, info) => {
    await open(page);
    expect(await widths(page)).toEqual({ scrollWidth: 390, innerWidth: 390 });
    const rows = page.locator('[data-liq-profile-histogram] .row');
    expect(await rows.count()).toBeGreaterThan(10);
    const prices = (await page.locator('[data-liq-profile-histogram] .row .price').allInnerTexts()).map(Number);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
    await expect(page.locator('table.top')).toHaveCount(0);
    await shoot(page, info, 'instrument-liq-profile-390.png');
  });

  test('a tap on a band opens its venue split; a missing venue says so there too', async ({ page }, info) => {
    await open(page, 'not_recorded');
    const busy = page.locator('[data-liq-profile-histogram] .row').filter({ has: page.locator('.amount') }).first();
    await busy.tap();
    const tapped = page.locator('[data-liq-profile-tapped]');
    await expect(tapped).toBeVisible();
    await expect(tapped).toContainText('Binance');
    await expect(tapped.locator('[data-venue-missing]')).toContainText('OKX');
    expect(await widths(page)).toEqual({ scrollWidth: 390, innerWidth: 390 });
    await shoot(page, info, 'instrument-liq-profile-390-tapped.png');
  });
});
