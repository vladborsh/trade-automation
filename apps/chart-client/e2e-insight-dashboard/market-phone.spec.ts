import { expect, test, type Page } from '@playwright/test';
import cards from './fixtures/context-cards.json';
import insights from './fixtures/market-insights.24h.json';
import kpis from './fixtures/market-kpis.json';
import overview from './fixtures/liquidations-overview.24h.json';
// IB-090: real answers from slot dev-3 (2026-11-03): 30 positioning rows with oiUsd, caps for 24h
// (coloured) and 4h (refused by the source: period_not_served).
import caps24h from './fixtures/market-caps.24h.json';
import caps4h from './fixtures/market-caps.4h.json';
import positioning from './fixtures/market-positioning.24h.json';
// IB-089: the contract's block fixture carries what a young slot cannot — a 30-day norm, an outlier
// hour, a verdict, a series — so the charts are also measured with everything drawn.
import normBlock from '../../../libs/contracts/test/fixtures/liquidation-block.24h.json';

/**
 * IB-088 acceptance (Architect dd91ada): the market page on a 390×844 phone — no page horizontal
 * scroll (measured, not eyeballed), readable text, touch targets ≥ 40 px, tables scrolling inside
 * their own box — and the same page at desktop width. Full-page screenshots of both are attached.
 *
 * The data is real: four responses captured from slot dev-3's bot on 2026-11-03 (20 coins, a
 * 30-row feed, six KPI tiles, an R4 insight), so the widths here are the widths a member sees.
 * The page clock is pinned to the capture's `asOf`, so a green run does not depend on today.
 */
const MEMBER = { user: { id: 1, tgUserId: 111, role: 'member', lang: 'en', login: 'e2e' } };

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/web/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/web', '');
    const period = new URL(route.request().url()).searchParams.get('period') ?? '24h';
    const body: Record<string, unknown> = {
      '/auth/me': MEMBER,
      '/context/cards': cards,
      '/market/kpis': kpis,
      // the captured answers are 24h; another period is the same shape with its own label
      '/market/insights': { ...insights, period },
      '/liquidations/overview': { ...overview, block: { ...overview.block, period } },
      '/calendar/upcoming': { events: [] },
      '/market/positioning': { ...positioning, period },
      '/market/caps': period === '4h' ? caps4h : { ...caps24h, period },
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
}

async function withNormBlock(page: Page): Promise<void> {
  const asOf = normBlock.hourly.buckets[normBlock.hourly.buckets.length - 1].time + 1_800;
  await page.route('**/api/web/liquidations/overview**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...overview, asOf, block: normBlock }) }));
}

/**
 * IB-102: the recorded card (2026-11-03) predates `history`. A SYNTHETIC 31-day history, ending at the
 * recorded `now` (26) and passing through the recorded previous (37) and week-ago (48) readings, with one
 * missed day (10-20): test data, not a capture.
 */
const SYNTHETIC_FNG_HISTORY = Array.from({ length: 31 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 9, 4) + i * 86_400_000).toISOString().slice(0, 10);
  const value = day === '2026-11-03' ? 26 : day === '2026-11-02' ? 37 : day === '2026-10-27' ? 48 : Math.round(55 + 20 * Math.sin(i / 4) - i * 0.6);
  return { day, value, classification: value <= 24 ? 'Extreme Fear' : value <= 44 ? 'Fear' : value <= 55 ? 'Neutral' : 'Greed' };
}).filter((r) => r.day !== '2026-10-20');
async function withFngHistory(page: Page): Promise<void> {
  await page.route('**/api/web/context/cards**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...cards, fearGreed: { ...cards.fearGreed, history: SYNTHETIC_FNG_HISTORY } }) }));
}

async function openMarket(page: Page, setup?: (page: Page) => Promise<void>): Promise<void> {
  await page.clock.install({ time: overview.asOf * 1000 + 30_000 });
  await mockApi(page);
  if (setup) await setup(page);
  await page.goto('/market?p=24h');
  await page.clock.runFor(2_000);
  await expect(page.locator('app-kpi-strip')).toContainText('2.62');
  await expect(page.locator('app-insights-block')).toContainText('XRPUSDT');
}

/** Everything a reader or a thumb meets, measured in the page. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} «${(el.textContent ?? '').trim().slice(0, 30)}»`;
    const small: string[] = [];
    for (const el of document.querySelectorAll('app-market *')) {
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (ownText && visible(el) && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(`${label(el)} ${getComputedStyle(el).fontSize}`);
    }
    const tiny: string[] = [];
    for (const el of document.querySelectorAll('app-market a[href], app-market button, app-market input, app-market select')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 40 || r.width < 40) tiny.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    // a table wider than the screen is fine only inside a box that scrolls it
    const loose: string[] = [];
    for (const t of document.querySelectorAll('app-market table')) {
      if (t.getBoundingClientRect().width <= window.innerWidth) continue;
      let p = t.parentElement; let boxed = false;
      while (p && p.tagName !== 'APP-MARKET') {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && p.getBoundingClientRect().width <= window.innerWidth) { boxed = true; break; }
        p = p.parentElement;
      }
      if (!boxed) loose.push(label(t));
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, small, tiny, loose };
  });
}

test.describe('market page — phone 390×844 (IB-088)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('no page horizontal scroll, text ≥ 12 px, targets ≥ 40 px, tables scroll in their own box', async ({ page }, info) => {
    await openMarket(page);
    const m = await measure(page);
    await info.attach('phone-390.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(m.innerWidth).toBe(390);
    expect(m.scrollWidth).toBeLessThanOrEqual(390);
    expect(m.small).toEqual([]);
    expect(m.tiny).toEqual([]);
    expect(m.loose).toEqual([]);
  });

  test('IB-089 charts with a norm: outlier «×», verdict, cards — still no page scroll, targets ≥ 40 px', async ({ page }, info) => {
    await openMarket(page, withNormBlock);
    await expect(page.locator('app-liq-hourly text.callout')).toHaveCount(1);
    await expect(page.locator('app-liq-hourly line.norm')).toHaveCount(2);
    await expect(page.locator('app-liq-where')).toContainText('×2.4');
    await expect(page.locator('app-liq-large circle')).toHaveCount(3);
    const m = await measure(page);
    await info.attach('phone-390-norm.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(m.scrollWidth).toBeLessThanOrEqual(390);
    expect(m.small).toEqual([]);
    expect(m.tiny).toEqual([]);
    // every chart fits the screen: an SVG wider than the phone would be a scroll the page hides
    const widest = await page.locator('app-market svg').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
    expect(widest).toBeLessThanOrEqual(390);
  });

  test('IB-089 phone: large cards stop at 5 with «show all»; the old list and table are gone', async ({ page }) => {
    await openMarket(page);
    const cards = page.locator('app-liq-large li');
    const total = overview.block.large.length;
    expect(total).toBeGreaterThan(5);
    await expect(cards.filter({ visible: true })).toHaveCount(5);
    await page.getByRole('button', { name: `Show all (${total})` }).click();
    await page.clock.runFor(100); // the page's timers are faked: let Angular render
    await expect(cards.filter({ visible: true })).toHaveCount(total);
    await expect(page.locator('app-liquidations-feed, app-liquidations-where')).toHaveCount(0);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.getByRole('button', { name: 'Show fewer' }).first().click();
    await page.clock.runFor(100);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(height);
  });

  test('IB-101 phone: «where» folds to the top 8 with «12 more coins · $X»; the button is ≥ 40 px; show all, then a new period folds it again', async ({ page }, info) => {
    await openMarket(page);
    const where = page.locator('app-liq-where');
    const rows = where.locator('li.row');
    const active = overview.block.perCoin.filter((c) => c.totals.usd > 0).length;
    expect(active).toBe(20); // the recording: 20 coins, so 12 fold away
    await expect(rows).toHaveCount(8);
    await expect(where).toContainText('12 more coins · $');
    const toggle = where.getByRole('button', { name: 'Show all (12)' });
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    // folded, the block needs no scrolling of its own and the page none sideways
    expect(await where.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await info.attach('phone-390-where-folded.png', { body: await where.screenshot(), contentType: 'image/png' });
    await toggle.click();
    await page.clock.runFor(100);
    await expect(rows).toHaveCount(20);
    await expect(where.getByRole('button', { name: 'Show fewer' })).toBeVisible();
    await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: '4h', exact: true }).click();
    await page.clock.runFor(2_000);
    await expect(rows).toHaveCount(8); // a new period starts folded
  });

  test('IB-102 phone: the Fear & Greed gauge and its 30-day line fit, no page scroll', async ({ page }, info) => {
    await openMarket(page, withFngHistory);
    const card = page.locator('#sentiment app-fear-greed-gauge');
    await expect(card.locator('svg.gauge path.arc')).toHaveCount(5);
    await expect(card.locator('.value')).toHaveText('26');
    await expect(card.locator('svg.line polyline.history')).toBeVisible();
    await expect(card).toContainText('source: alternative.me');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await info.attach('phone-390-fng.png', { body: await page.locator('#sentiment').screenshot(), contentType: 'image/png' });
  });

  test('IB-090 heat table: scrolls in its own box with the ticker column pinned; every cell readable', async ({ page }) => {
    await openMarket(page);
    const box = page.locator('app-pos-heat .scroll');
    const rows = page.locator('app-pos-heat tbody tr');
    await expect(rows).toHaveCount(positioning.rows.length);
    await expect(rows.filter({ visible: true })).toHaveCount(10); // phone: the ten most unusual first
    await page.locator('app-pos-heat').getByRole('button', { name: `Show all (${positioning.rows.length})` }).click();
    await page.clock.runFor(100);
    await expect(rows.filter({ visible: true })).toHaveCount(positioning.rows.length);
    const before = await page.locator('app-pos-heat tbody th').first().boundingBox();
    const scrolled = await box.evaluate((el) => { el.scrollLeft = 400; return el.scrollLeft; });
    expect(scrolled).toBeGreaterThan(0); // the table really is wider than the phone
    const after = await page.locator('app-pos-heat tbody th').first().boundingBox();
    expect(after?.x).toBeCloseTo(before?.x ?? -1, 0); // pinned
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('IB-090 caps: CoinGecko credited beside the treemap; 4h says the source publishes no change', async ({ page }) => {
    await openMarket(page);
    const source = page.locator('app-caps-block a.source');
    await expect(source).toBeVisible();
    await expect(source).toHaveAttribute('href', caps24h.source.url);
    const colours = await page.locator('app-caps-treemap rect').evaluateAll((els) => new Set(els.map((e) => e.getAttribute('fill'))).size);
    expect(colours).toBeGreaterThan(3);
    await page.getByRole('button', { name: '4h', exact: true }).click();
    await page.clock.runFor(1_000);
    await expect(page.locator('app-caps-block')).toContainText('CoinGecko does not publish a 4h change');
    const fills4h = await page.locator('app-caps-treemap rect').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('fill')))]);
    expect(fills4h).toEqual(['#21262d']);
    await expect(source).toBeVisible();
    const sum = await page.locator('app-dominance-bar .seg').evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width, 0));
    const bar = await page.locator('app-dominance-bar .bar').evaluate((e) => e.getBoundingClientRect().width);
    expect(sum).toBeCloseTo(bar, 0);
  });

  test('IB-090 quadrant and treemap fit the phone and keep their aspect', async ({ page }) => {
    await openMarket(page);
    for (const sel of ['app-pos-quadrant svg', 'app-caps-treemap svg']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.height / b.width).toBeGreaterThan(0.6);
    }
    await expect(page.locator('app-pos-quadrant circle')).toHaveCount(positioning.rows.filter((r) => r.priceChangePct.value !== null && r.oiChangePct.value !== null).length);
  });

  test('one column: every card starts at the same left edge', async ({ page }) => {
    await openMarket(page);
    const lefts = await page.locator('app-market div.cards > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  });

  test('the period switch puts the period in the URL and asks for it', async ({ page }) => {
    await openMarket(page);
    const asked = page.waitForRequest((r) => r.url().includes('/market/insights') && r.url().includes('period=1h'));
    await page.getByRole('button', { name: '1h', exact: true }).click();
    await page.clock.runFor(500);
    await asked;
    await expect(page).toHaveURL(/[?&]p=1h/);
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  });
});

test.describe('market page — desktop 1440×900 (IB-088)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('IB-102 desktop: the gauge and the 30-day line', async ({ page }, info) => {
    await openMarket(page, withFngHistory);
    const card = page.locator('#sentiment app-fear-greed-gauge');
    await expect(card.locator('svg.line polyline.history')).toBeVisible();
    await info.attach('desktop-fng.png', { body: await page.locator('#sentiment').screenshot(), contentType: 'image/png' });
  });

  test('IB-101 desktop: «where» folds to the top 8 and unfolds to all 20', async ({ page }, info) => {
    await openMarket(page);
    const where = page.locator('app-liq-where');
    await expect(where.locator('li.row')).toHaveCount(8);
    await expect(where).toContainText('12 more coins · $');
    await info.attach('desktop-where-folded.png', { body: await where.screenshot(), contentType: 'image/png' });
    await where.getByRole('button', { name: 'Show all (12)' }).click();
    await page.clock.runFor(100);
    await expect(where.locator('li.row')).toHaveCount(20);
  });

  test('no horizontal scroll, and the screenshot', async ({ page }, info) => {
    await openMarket(page, withNormBlock);
    const m = await measure(page);
    await info.attach('desktop-1440.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(m.scrollWidth).toBeLessThanOrEqual(1440);
    expect(m.small).toEqual([]);
    // desktop shows every large card: the limit is a phone rule
    await expect(page.locator('app-liq-large li').filter({ visible: true })).toHaveCount(normBlock.large.length);
  });
});
