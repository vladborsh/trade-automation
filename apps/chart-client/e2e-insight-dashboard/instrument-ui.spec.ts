import { expect, test, type Page } from '@playwright/test';
import recorded from './fixtures/instrument-btcusdt.json';
import { gotoReady, readyAfter } from './ready';

/**
 * IB-099 — the owner's instrument-page fixes, in a real browser: the calendar badge opens the
 * tooltip, the legend switch (on the chart since IB-105) survives a reload, full screen resizes the SAME chart and gives the
 * view back. The API is replayed from a recording of slot dev-3 (BTCUSDT, 2026-11-03, one USD
 * high-impact event in the 1m window: «Congressional Elections», 15:16 UTC) with the page clock
 * fixed to the recording's instant, so every window the page asks for is the one recorded.
 * (`/auth/me` is replaced by a plain member in English.)
 */
const responses = recorded.responses as Record<string, { status: number; body: unknown }>;

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const hit = responses[u.pathname.replace('/api/web', '') + u.search];
    return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: u.pathname }) });
  });
  await gotoReady(page, '/instrument/BTCUSDT', INSTRUMENT_READY(page)); // IB-BUG-049
  await expect(page.locator('.calendar-badge')).toHaveCount(1);
}

/**
 * IB-BUG-049: the instrument page is ready when its candles and calendar have been served and the
 * calendar badge (drawn from both) is on the chart — instead of a blind 30 s on the badge.
 */
const INSTRUMENT_READY = (page: Page) => ({ served: ['/series/candles', '/calendar/events'], ready: page.locator('.calendar-badge') });

/** IB-BUG-019's measure: what the CHART holds (lightweight-charts' panes and series, and the marks the
 *  component attached), read through Angular's dev-mode handle — not a DOM node the switch could hide. */
async function chartState(page: Page): Promise<{ panes: number; series: number; primitives: number }> {
  return page.evaluate(() => {
    const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
    const c = ng.getComponent(document.querySelector('app-instrument-chart')!) as {
      chart: { panes(): Array<{ getSeries(): unknown[] }> };
      renderers: { paneMarks: unknown[] };
    };
    const panes = c.chart.panes();
    return { panes: panes.length, series: panes.reduce((n, p) => n + p.getSeries().length, 0), primitives: c.renderers.paneMarks.length };
  });
}
/**
 * IB-BUG-049: the live tail REPLACES the calendar badge every ~5 s (`replaceChildren`; probed under CPU
 * ×8, 3 of 3 runs, 4.5–5 s apart, never hidden). `locator.boundingBox()` resolves the element, then
 * measures it in a second round trip: a replacement in between reads null (4 of 5 runs at ×8, on
 * master too), and under ×8 each round trip is slow enough that polling it ran out of time as well.
 * Found and measured in ONE page task, nothing can come in between, and no budget is needed.
 */
async function boxOf(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`boxOf: no ${sel}`);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * IB-BUG-049 — a named budget per full instrument-page load, for a test that loads the page more than
 * once (the suite's flat 60 s is per test, whatever it does). Measured on 6019fda1, the 3-load reload
 * test, 3 runs each: 13.2–13.6 s at ×1 (≈ 4.5 s a load) and 68.0–69.4 s under CPU ×8 (≈ 23 s a
 * load), which the flat 60 s failed 1 of 3. 40 s a load keeps ×8 green with room; a page that never
 * becomes ready still fails, naming what gotoReady / readyAfter waited for.
 */
const INSTRUMENT_LOAD_MS = 40_000;

test.describe('instrument page — desktop (IB-099)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('item 1: the flag badge is a ≥ 24 px target; a click pins the tooltip, a second click closes it; hover shows it', async ({ page }) => {
    await open(page);
    const badge = page.locator('.calendar-badge');
    await expect(badge).toBeVisible();
    const box = await boxOf(page, '.calendar-badge'); // IB-BUG-049: one atomic read, see boxOf
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    await expect(badge.locator('svg')).toHaveCount(1); // an SVG flag, not an emoji
    await badge.click();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
    await page.mouse.move(10, 10); // pinned: leaving does not close it
    await expect(page.locator('.calendar-tooltip')).toBeVisible();
    await badge.click();
    await expect(page.locator('.calendar-tooltip')).toHaveCount(0);
    // IB-BUG-045: the pointer is still ON the badge after that click, so a hover to its centre is no
    // entry (a mousemove, no mouseenter); it passed only when the live tail rebuilt the badge under the
    // pointer within the 5 s (measured 4.1–4.4 s after the hover, 6 of 6). Leave, then enter.
    await page.mouse.move(10, 10);
    await badge.hover();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
  });

  test('IB-105: the on-chart switch hides every legend and nothing else; same spot to show them; reload keeps it', async ({ page }) => {
    test.setTimeout(3 * INSTRUMENT_LOAD_MS); // open + two reloads (IB-BUG-049)
    await open(page);
    const legends = page.locator('.pane-legend');
    const toggle = page.locator('.chart-column app-legend-toggle button');
    await expect(legends.first()).toBeVisible();
    // one control: the toolbar has no legend switch any more
    await expect(page.locator('header.controls').getByRole('button', { name: /legend/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /legend/i })).toHaveCount(1);
    const before = await chartState(page);
    expect(before.series).toBeGreaterThan(5);
    expect(before.primitives).toBeGreaterThan(0);
    const spot = (await toggle.boundingBox())!;

    await toggle.click();
    await expect(legends.filter({ visible: true })).toHaveCount(0);
    expect(await chartState(page)).toEqual(before); // IB-BUG-019: the chart keeps every series and mark
    expect(await toggle.boundingBox()).toEqual(spot); // the way back is where it was
    await expect(toggle).toHaveAttribute('aria-label', 'Show legend');

    await readyAfter(page, () => page.reload(), INSTRUMENT_READY(page));
    await expect(page.locator('.calendar-badge')).toHaveCount(1);
    await expect(legends.filter({ visible: true })).toHaveCount(0);
    expect(await chartState(page)).toEqual(before);

    await toggle.click();
    await expect(legends.first()).toBeVisible();
    await readyAfter(page, () => page.reload(), INSTRUMENT_READY(page));
    await expect(page.locator('.calendar-badge')).toHaveCount(1);
    await expect(legends.first()).toBeVisible();
    expect(await chartState(page)).toEqual(before);
  });

  test('IB-105: the switch sits at the price legend\'s corner, small, clear of the legend, the price axis, the badge and full screen', async ({ page }, info) => {
    await open(page);
    const t = (await page.locator('.chart-column app-legend-toggle button').boundingBox())!;
    expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(22); // a small glyph on desktop
    for (const [name, sel] of [['price legend', '.pane-legend[data-pane="price"]'], ['badge', '.calendar-badge'], ['full screen', 'app-fullscreen-button button']] as const) {
      expect(overlap(t, await boxOf(page, sel)), name).toBe(false);
    }
    const host = (await page.locator('.chart-host').boundingBox())!;
    expect(t.x - host.x).toBeLessThan(12); // at the chart's left edge…
    expect(t.y - host.y).toBeLessThan(12); // …and its top: the corner, far from the price axis on the right
    // on the legend's FIRST line («Price · USDT»): the legend itself wraps to two lines at 1440
    const title = (await page.locator('.pane-legend[data-pane="price"] .pane-title').boundingBox())!;
    expect(Math.abs((t.y + t.height / 2) - (title.y + title.height / 2))).toBeLessThanOrEqual(3);
    await info.attach('desktop-legend-toggle.png', { body: await page.locator('.chart-column').screenshot(), contentType: 'image/png' });
  });

  test('IB-BUG-033: venues are spelled as names on the instrument page (footer, legends; the tooltip by its unit spec) — never our keys', async ({ page }) => {
    await open(page);
    const RAW = /\b(binance|bybit|okx|deribit|defillama|coinbase)\b/g;
    await expect(page.locator('.pane-note')).toContainText('Binance, Bybit, OKX');
    // the raw-data table's `venue` column is English-by-rule (matched against the venue's data and our
    // logs, allow-listed in no-literals.spec.ts); everything a member reads as a sentence is checked
    const text = await page.locator('app-instrument').evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('table.top').forEach((t) => t.remove());
      return copy.innerText ?? copy.textContent ?? '';
    });
    expect(text.match(RAW) ?? []).toEqual([]);
  });

  test('item 3: full screen grows the SAME chart and gives the view back; the button and Esc both leave', async ({ page }) => {
    await open(page);
    const canvas = page.locator('.chart-host canvas').first();
    await canvas.evaluate((el) => el.setAttribute('data-ib099', 'same'));
    const axisText = () => page.locator('.time-axis').innerText();
    const widthBefore = (await page.locator('.chart-host').boundingBox())!.width;
    const axisBefore = await axisText();
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeGreaterThan(widthBefore + 100);
    expect(await page.evaluate(() => !!document.fullscreenElement || !!document.querySelector('.fs-fallback'))).toBe(true);
    await page.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeCloseTo(widthBefore, 0);
    await expect(page.locator('.chart-host canvas[data-ib099="same"]')).toHaveCount(1); // not re-created
    await expect.poll(axisText).toBe(axisBefore); // the same bars on screen: zoom and scroll kept
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeGreaterThan(widthBefore + 100);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeCloseTo(widthBefore, 0);
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  });
});

test.describe('instrument page — phone 390×844 (IB-099)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the badge is a ≥ 40 px target and a tap opens the tooltip; the page does not scroll sideways', async ({ page }) => {
    await open(page);
    const badge = page.locator('.calendar-badge');
    const box = await boxOf(page, '.calendar-badge'); // IB-BUG-049: one atomic read, see boxOf
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    await badge.tap();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const fs = (await page.getByRole('button', { name: 'Full screen' }).boundingBox())!;
    expect(fs.height).toBeGreaterThanOrEqual(40);
  });

  test('IB-105 phone: the legend switch is a small glyph with a 40 × 40 target, clear of the badge; a tap hides, a tap shows', async ({ page }, info) => {
    await open(page);
    const toggle = page.locator('.chart-column app-legend-toggle button');
    const g = (await toggle.boundingBox())!;
    expect(Math.max(g.width, g.height)).toBeLessThanOrEqual(22); // the glyph stays small…
    // …and the target is 40 × 40: every point of the square at the chart's corner lands on the switch
    const host = (await page.locator('.chart-column').boundingBox())!;
    const hits = await page.evaluate(([x0, y0]) => [[1, 1], [39, 1], [1, 39], [39, 39], [20, 20]].map(([dx, dy]) =>
      !!document.elementFromPoint(x0 + dx, y0 + dy)?.closest('app-legend-toggle')), [host.x, host.y]);
    expect(hits).toEqual([true, true, true, true, true]);
    expect(overlap(g, await boxOf(page, '.calendar-badge'))).toBe(false); // IB-BUG-049: atomic, see boxOf
    const before = await chartState(page);
    await toggle.tap();
    await expect(page.locator('.pane-legend').filter({ visible: true })).toHaveCount(0);
    expect(await chartState(page)).toEqual(before);
    await info.attach('phone-legends-hidden.png', { body: await page.locator('.chart-column').screenshot(), contentType: 'image/png' });
    await toggle.tap();
    await expect(page.locator('.pane-legend').first()).toBeVisible();
    await info.attach('phone-legends-shown.png', { body: await page.locator('.chart-column').screenshot(), contentType: 'image/png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test.describe('the top-50 table prints amounts without float noise (IB-BUG-024)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('OKX quantities recorded as 0.6715000000000001 and 0.27090000000000003 read 0.6715 and 0.2709', async ({ page }) => {
    await open(page);
    const cells = page.locator('table.top td.num');
    await expect(cells.first()).toBeVisible();
    const texts = await cells.allTextContents();
    expect(texts.map((x) => x.trim())).toEqual(expect.arrayContaining(['0.6715', '0.2709']));
    expect(texts.filter((x) => /\d\.\d{9,}/.test(x))).toEqual([]);
  });
});

test.describe('an R4 statement opens the whole period (IB-BUG-023)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('click → /instrument/BTCUSDT?at=<period start>&span=1h, on 1m, the start marked «period start»', async ({ page }) => {
    const nowSec = Math.floor(recorded.fixedTimeMs / 1000);
    const at = nowSec - 3_600; // the 1h period's start: its 1m frame is the window recorded
    const basis = { window: '1h', venues: ['binance'], sampleWindows: 720, observedWindows: 720, from: nowSec - 30 * 86_400 };
    const statement = {
      ruleId: 'R4', block: 'positioning', key: 'insight.oi_vs_price', rarity: 0.95, magnitude: 2.2, basis,
      params: { symbol: 'BTCUSDT', quadrant: 'new_longs', oiPct: 2.2, pricePct: 0.4 },
      link: { route: 'instrument', symbol: 'BTCUSDT', timeSec: at }, chart: null,
    };
    const neutral = (block: string) => ({ block, statement: null, neutral: { key: 'insight.neutral', reason: 'nothing_unusual', basis } });
    const insights = { period: '1h', asOf: nowSec, top: [statement], blocks: ['liquidations', 'positioning', 'caps', 'flows', 'sentiment'].map(neutral) };
    await page.clock.setFixedTime(recorded.fixedTimeMs);
    await page.route('**/api/web/**', (route) => {
      const u = new URL(route.request().url());
      const path = u.pathname.replace('/api/web', '');
      if (path === '/market/insights') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(insights) });
      const hit = responses[path + u.search];
      return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: path }) });
    });
    const link = page.locator('#insights a.link').first();
    await gotoReady(page, '/market?p=1h', { served: ['/market/insights'], ready: link }); // IB-BUG-049
    await expect(link).toHaveAttribute('href', `/instrument/BTCUSDT?at=${at}&span=1h`);
    const marker = page.locator('.focus-marker');
    // an in-app navigation: the instrument route's chunk, its candles, then the marker
    await readyAfter(page, () => link.click(), { served: ['/series/candles'], ready: marker });
    await expect(page).toHaveURL(new RegExp(`/instrument/BTCUSDT\\?at=${at}&span=1h$`));
    await expect(marker).toHaveAttribute('data-at', String(at));
    await expect(marker).toContainText('period start');
    await expect(page.getByRole('button', { name: '1m', exact: true })).toHaveClass(/active/);
  });
});

