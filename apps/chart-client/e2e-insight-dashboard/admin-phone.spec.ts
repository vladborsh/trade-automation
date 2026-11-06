import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gotoReady } from './ready';
// IB-BUG-034: real answers from slot dev-3's bot (2026-11-04), signed in as its admin
import streams from './fixtures/admin-health-streams.json';
import db from './fixtures/admin-health-db.json';
import members from './fixtures/admin-members.json';
import loginEvents from './fixtures/admin-login-events.json';
// IB-112: SYNTHETIC — the alerts endpoint has no server yet; shaped by the IB-109 contract, longest symbol included
import alertsPage from './fixtures/admin-alerts.synthetic.json';
// IB-122: the «Large liquidations» section, the real answer of slot dev-3's LiqAlertsAdmin (2026-11-05). Its journal was
// empty, so ONE synthetic row (the widest: a continuation) is appended below, so the journal table is measured too.
import liqPage from './fixtures/admin-alerts-liq.json';
// IB-124: the «Funding» section, the real answer of slot dev-3's FundingAlertsAdmin (2026-11-06, after the loop's first live
// check). Its journal was empty, so ONE synthetic row (the widest: a flip on the longest symbol) is appended below.
import fundingPage from './fixtures/admin-alerts-funding.json';
// IB-126: the «Levels» section, the real answer of slot dev-1's LevelAlertsAdmin (2026-11-06, after the loop's first live
// closes and the five seeds). Its journal was empty, so ONE synthetic row (the widest: a crossunder of the monthly high on
// the longest symbol) is appended below.
import levelsPage from './fixtures/admin-alerts-levels.json';
// IB-128: the custom levels block, the real answer of slot dev-3 (2026-11-06: three adds, a switch, a delete), plus ONE
// synthetic row, the widest: the longest symbol, an 8-decimal price and a long note
import customPage from './fixtures/admin-alerts-levels-custom.json';

const liqWithRow = {
  ...liqPage,
  alerts: [{ id: 1, source: 'live', event: 'continuing', symbol: '1000PEPEUSDT', side: 'short', at: 1_793_888_888, sumUsd: 12_345_678, thresholdUsd: 5_000_000, coins: ['1000PEPEUSDT'], news: true, firedAt: null, late: true, recipients: 0 }],
};

const fundingWithRow = {
  ...fundingPage,
  alerts: [{ id: 1, source: 'live', event: 'flip', symbol: '1000PEPEUSDT', side: 'high', at: 1_793_888_888, rate: -0.00012345, intervalH: 4, ratePer8h: -0.0002469, episodeHours: 131.5, firedAt: null, late: false, recipients: 0 }],
};

const levelsWithRow = {
  ...levelsPage,
  alerts: [{ id: 1, source: 'live', event: 'crossunder', symbol: '1000PEPEUSDT', kind: 'PMH', price: 0.012345678, at: 1_793_888_888, close: 0.012299991, firedAt: null, late: true, recipients: 0, customLevelId: null },
    // IB-128: slot dev-3's REAL journal row of its first custom level alert (2026-11-06 08:15 bar, sending off)
    { id: 57, source: 'live', event: 'sweep_above', symbol: 'BTCUSDT', price: 75676, kind: 'custom', customLevelId: 1, at: 1793952900, close: 75616.9, firedAt: null, late: false, recipients: 0 }],
};

const customWithRow = {
  levels: [...customPage.levels, {
    id: 99, symbol: '1000PEPEUSDT', base: '1000PEPE', price: 0.012345678, note: 'range high of the October squeeze, retested twice',
    events: { breakout_up: true, breakout_down: false, sweep_above: true, sweep_below: false }, createdBy: 2, createdAt: 1_793_888_888,
  }],
};

/**
 * IB-BUG-034 — the admin pages on a 390×844 phone and at 1440: the PAGE never scrolls sideways. A
 * table wider than the screen scrolls inside its own box; nothing is clipped out of reach.
 *
 * Measured against 390 itself, not `innerWidth`: on a mobile viewport an over-wide page widens the
 * layout viewport with it (the Health page read innerWidth 560 = scrollWidth 560 on master), so
 * «scrollWidth == innerWidth» alone passes while the page is broken.
 */
const ADMIN = { user: { id: 1, tgUserId: 111, role: 'admin', lang: 'ru', login: 'owner' } };

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/web/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/web', '');
    const body: Record<string, unknown> = {
      '/auth/me': ADMIN,
      '/health/streams': streams,
      '/health/db': db,
      '/admin/members': members,
      '/admin/login-events': loginEvents,
      '/admin/alerts': alertsPage,
      '/admin/alerts/liq': liqWithRow,
      '/admin/alerts/funding': fundingWithRow,
      '/admin/alerts/levels': levelsWithRow,
      '/admin/alerts/levels/custom': customWithRow,
      '/calendar/upcoming': { events: [] },
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
}

/** IB-128: `IB128_SHOTS` = a directory: the custom levels block is saved there as `name`. */
async function customShot(page: Page, name: string): Promise<void> {
  const dir = process.env['IB128_SHOTS'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.locator('app-admin-custom-levels').screenshot({ path: join(dir, name) });
}

/** The page's width, and every table: whether it fits, or else whether a scroll box of its own holds it. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const vw = 0 + document.documentElement.clientWidth;
    const tables = [...document.querySelectorAll('table')].map((t) => {
      let box: HTMLElement | null = t.parentElement;
      while (box && !['auto', 'scroll'].includes(getComputedStyle(box).overflowX)) box = box.parentElement;
      const r = t.getBoundingClientRect();
      return {
        fits: r.left >= 0 && r.right <= vw + 0.5,
        // a scroll box of its own: inside the screen, and it really scrolls to the table's width
        boxed: box !== null && box.getBoundingClientRect().right <= vw + 0.5 && box.scrollWidth >= Math.floor(r.width),
      };
    });
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, tables };
  });
}

const PAGES = [
  ['/health', 'Сбор данных'],
  ['/admin/members', 'Участники'],
  ['/admin/logins', 'Журнал входов'],
  ['/admin/alerts', 'Сигналы OI'],
] as const;

/** IB-BUG-049: what each page must have been SERVED before it is measured — instead of a 5 s `h1` wait. */
const SERVED: Record<(typeof PAGES)[number][0], readonly string[]> = {
  '/health': ['/health/streams', '/health/db'],
  '/admin/members': ['/admin/members'],
  '/admin/logins': ['/admin/login-events'],
  '/admin/alerts': ['/admin/alerts', '/admin/alerts/liq', '/admin/alerts/funding', '/admin/alerts/levels', '/admin/alerts/levels/custom'],
};
const openReady = (page: Page, path: (typeof PAGES)[number][0]) =>
  gotoReady(page, path, { served: SERVED[path], ready: page.locator('table').first() });

test.describe('admin pages — phone 390×844 (IB-BUG-034)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  for (const [path, title] of PAGES) {
    test(`${path}: no page horizontal scroll; every table fits or scrolls in its own box`, async ({ page }, info) => {
      await mockApi(page);
      await openReady(page, path); // IB-BUG-049
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator('table').first()).toBeVisible();
      if (path === '/admin/alerts') await expect(page.locator('app-admin-liq-alerts tbody tr')).toHaveCount(liqPage.coins.length + 1);
      if (path === '/admin/alerts') await expect(page.locator('app-admin-funding-alerts tbody tr')).toHaveCount(fundingPage.coins.length + 1);
      // IB-126: the event grid (8 kinds), the coins, and the journal row; IB-128: and the custom levels' rows inside it
      if (path === '/admin/alerts') await expect(page.locator('app-admin-level-alerts tbody tr')).toHaveCount(8 + levelsPage.coins.length + levelsWithRow.alerts.length + customWithRow.levels.length);
      if (path === '/admin/alerts') await expect(page.locator('app-admin-custom-levels tbody tr')).toHaveCount(customWithRow.levels.length);
      if (path === '/admin/alerts') await expect(page.locator('app-admin-level-alerts > section > .scroll tbody tr', { hasText: '75616.9' })).toContainText('свой #1');
      if (path === '/admin/alerts') {
        // IB-144 (V42, V44): a «скрытые» checkbox per TF, and the hidden journal row (the longest symbol) labelled
        await expect(page.getByRole('checkbox', { name: /^(15m|1h|4h) скрытые$/ })).toHaveCount(3);
        await expect(page.locator('tbody tr', { hasText: '1000PEPEUSDT' }).locator('.kind')).toHaveText('· скрытая дивергенция OI');
      }
      const m = await measure(page);
      expect(m.innerWidth).toBe(390);
      expect(m.scrollWidth).toBeLessThanOrEqual(390);
      expect(m.tables.length).toBeGreaterThan(0);
      expect(m.tables.filter((t) => !t.fits && !t.boxed)).toEqual([]);
      if (path === '/admin/alerts') await customShot(page, 'admin-custom-levels-390.png');
      await info.attach(`phone-390${path.replaceAll('/', '-')}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});

test.describe('admin pages — desktop 1440×900 (IB-BUG-034)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const [path, title] of PAGES) {
    test(`${path}: every table fits the page at desktop width`, async ({ page }, info) => {
      await mockApi(page);
      await openReady(page, path); // IB-BUG-049
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator('table').first()).toBeVisible();
      const m = await measure(page);
      expect(m.scrollWidth).toBeLessThanOrEqual(1440);
      expect(m.tables.every((t) => t.fits)).toBe(true);
      if (path === '/admin/alerts') await customShot(page, 'admin-custom-levels-1440.png');
      await info.attach(`desktop-1440${path.replaceAll('/', '-')}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});
