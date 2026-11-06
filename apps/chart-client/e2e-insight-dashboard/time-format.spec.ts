import { expect, test, type Page, type TestInfo } from '@playwright/test';
import cards from './fixtures/context-cards.json';
import insights from './fixtures/market-insights.24h.json';
import kpis from './fixtures/market-kpis.json';
import overview from './fixtures/liquidations-overview.24h.json';
import caps24h from './fixtures/market-caps.24h.json';
import positioning from './fixtures/market-positioning.24h.json';
import box7d from './fixtures/liquidation-episodes.box-7d.json';
import recorded from './fixtures/instrument-btcusdt.json';
import flows from '../../../libs/contracts/test/fixtures/flows.24h.json';
import large from '../../../libs/contracts/test/fixtures/liquidations-large.24h.json';
import { gotoReady } from './ready';

/**
 * IB-152 (owner ruling A): one time format (`dd.MM HH:mm`) and one zone (the viewer's) on every page.
 *
 * Two parts:
 * - the proof: under a non-UTC browser zone (`Europe/Kyiv`, UTC+2 in November) the episode card on
 *   /liquidations and the instrument chart's time axis give the SAME hour for the same moment — the
 *   owner's case was the card at 17:01 local next to the chart's 15:01 UTC; and under UTC both give the UTC hour;
 * - the pictures: /market, /liquidations, /instrument, /positioning at 1240 and 390 in both zones,
 *   written to `SHOT_DIR` when it is set (the before/after side-by-side of the task report).
 */
const MEMBER = (lang: 'ru' | 'en') => ({ user: { id: 1, tgUserId: 111, role: 'member', lang, login: 'e2e' } });
const ZONES = ['Europe/Kyiv', 'UTC'] as const;
type ZoneId = (typeof ZONES)[number];

const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
const notFound = (path: string) => ({ status: 404, ...json({ code: 'NOT_FOUND', message: path }) });

async function openMarketLike(page: Page, url: string, ready: string, served: string): Promise<void> {
  await page.clock.install({ time: overview.asOf * 1000 + 30_000 });
  await page.route('**/api/web/**', async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    const period = u.searchParams.get('period') ?? '24h';
    const body: Record<string, unknown> = {
      '/auth/me': MEMBER('ru'),
      '/context/cards': cards,
      '/market/kpis': kpis,
      '/market/insights': { ...insights, period },
      '/liquidations/overview': { ...overview, block: { ...overview.block, period } },
      '/calendar/upcoming': { events: [] },
      '/market/positioning': { ...positioning, period },
      '/market/caps': { ...caps24h, period },
      '/market/flows': { ...flows, period },
    };
    await route.fulfill(path in body ? json(body[path]) : notFound(path));
  });
  await gotoReady(page, url, { served: [served], ready: page.locator(ready).first() });
  await page.clock.runFor(2_000);
}

async function openLiquidations(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('help-seen:liquidations', '1'); } catch { /* no storage */ } });
  await page.clock.install({ time: box7d.asOf * 1000 + 30_000 });
  await page.route('**/api/web/**', async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    const query = { period: '7d', symbol: 'all', minUsd: 100_000, side: 'all', venue: 'all' };
    const body: Record<string, unknown> = {
      '/auth/me': MEMBER('ru'),
      '/liquidations/episodes': { ...box7d, query },
      '/liquidations/large': { ...large, query },
    };
    await route.fulfill(path in body ? json(body[path]) : notFound(path));
  });
  await gotoReady(page, '/liquidations?p=7d', { served: ['/liquidations/episodes'], ready: page.locator('app-liq-episode-card').first() });
  await page.clock.runFor(2_000);
}

const responses = recorded.responses as Record<string, { status: number; body: unknown }>;
async function openInstrument(page: Page): Promise<void> {
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const hit = responses[u.pathname.replace('/api/web', '') + u.search];
    return route.fulfill({ status: hit?.status ?? 404, ...json(hit?.body ?? { code: 'NOT_RECORDED', message: u.pathname }) });
  });
  await gotoReady(page, '/instrument/BTCUSDT', { served: ['/series/candles', '/calendar/events'], ready: page.locator('.calendar-badge') });
}

/** What the instrument chart's time axis prints for a moment: its crosshair formatter, read in the page's own zone. */
async function axisLabel(page: Page, sec: number): Promise<string> {
  return page.evaluate((t) => {
    const ng = (window as unknown as { ng: { getComponent(el: Element): unknown } }).ng;
    const c = ng.getComponent(document.querySelector('app-instrument-chart')!) as {
      axis: { chart: { options(): { localization: { timeFormatter(t: number): string } } } };
    };
    return c.axis.chart.options().localization.timeFormatter(t);
  }, sec);
}

const hhmm = (sec: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(sec * 1000));

async function shoot(page: Page, info: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env['SHOT_DIR'];
  if (dir) await page.screenshot({ fullPage: true, path: `${dir}/${name}` });
}

for (const zone of ZONES) {
  test.describe(`IB-152 — one hour for one moment, browser zone ${zone}`, () => {
    test.use({ timezoneId: zone, viewport: { width: 1240, height: 900 } });

    test('the episode card and the instrument chart axis print the same hour', async ({ page }) => {
      const largest = [...box7d.episodes].sort((a, b) => b.usd - a.usd)[0];
      const expected = hhmm(largest.from, zone);
      await openLiquidations(page);
      const cardTimes = await page.locator('app-liq-episode-card .when').allInnerTexts();
      expect(cardTimes.join(' | ')).toContain(expected);
      // the other zone's hour is NOT what the card says (the spec can disagree)
      const other = hhmm(largest.from, zone === 'UTC' ? 'Europe/Kyiv' : 'UTC');
      expect(cardTimes.some((t) => t.includes(other))).toBe(false);

      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openInstrument(page);
      // the 1m chart (the recorded window): the axis label of the same moment carries the same hour
      expect(await axisLabel(page, largest.from - (largest.from % 60))).toContain(expected.slice(0, 5));
    });
  });
}

test.describe('IB-152 — pictures (SHOT_DIR)', () => {
  test.skip(!process.env['SHOT_DIR'], 'pictures only when SHOT_DIR is set');
  const tag = process.env['SHOT_TAG'] ?? 'shot';
  for (const zone of ZONES) {
    for (const width of [1240, 390]) {
      test.describe(`${zone} ${width}`, () => {
        test.use({ timezoneId: zone, viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
        const z = zone === 'UTC' ? 'utc' : 'kyiv';
        test('market', async ({ page }, info) => {
          await openMarketLike(page, '/market', 'app-insight-card', '/market/insights');
          await shoot(page, info, `${tag}-market-${z}-${width}.png`);
        });
        test('liquidations', async ({ page }, info) => {
          await openLiquidations(page);
          await shoot(page, info, `${tag}-liquidations-${z}-${width}.png`);
        });
        test('instrument', async ({ page }, info) => {
          await openInstrument(page);
          await shoot(page, info, `${tag}-instrument-${z}-${width}.png`);
        });
        test('positioning', async ({ page }, info) => {
          await openMarketLike(page, '/positioning?p=24h', 'app-pos-heat tbody tr', '/market/positioning');
          await shoot(page, info, `${tag}-positioning-${z}-${width}.png`);
        });
      });
    }
  }
});
