import { expect, test, type Page } from '@playwright/test';
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

const liqWithRow = {
  ...liqPage,
  alerts: [{ id: 1, source: 'live', event: 'continuing', symbol: '1000PEPEUSDT', side: 'short', at: 1_793_888_888, sumUsd: 12_345_678, thresholdUsd: 5_000_000, coins: ['1000PEPEUSDT'], news: true, firedAt: null, late: true, recipients: 0 }],
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
      '/calendar/upcoming': { events: [] },
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
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

test.describe('admin pages — phone 390×844 (IB-BUG-034)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  for (const [path, title] of PAGES) {
    test(`${path}: no page horizontal scroll; every table fits or scrolls in its own box`, async ({ page }, info) => {
      await mockApi(page);
      await page.goto(path);
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator('table').first()).toBeVisible();
      if (path === '/admin/alerts') await expect(page.locator('app-admin-liq-alerts tbody tr')).toHaveCount(liqPage.coins.length + 1);
      const m = await measure(page);
      expect(m.innerWidth).toBe(390);
      expect(m.scrollWidth).toBeLessThanOrEqual(390);
      expect(m.tables.length).toBeGreaterThan(0);
      expect(m.tables.filter((t) => !t.fits && !t.boxed)).toEqual([]);
      await info.attach(`phone-390${path.replaceAll('/', '-')}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});

test.describe('admin pages — desktop 1440×900 (IB-BUG-034)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const [path, title] of PAGES) {
    test(`${path}: every table fits the page at desktop width`, async ({ page }, info) => {
      await mockApi(page);
      await page.goto(path);
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator('table').first()).toBeVisible();
      const m = await measure(page);
      expect(m.scrollWidth).toBeLessThanOrEqual(1440);
      expect(m.tables.every((t) => t.fits)).toBe(true);
      await info.attach(`desktop-1440${path.replaceAll('/', '-')}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    });
  }
});
