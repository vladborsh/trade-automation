import { expect, test, type Page } from '@playwright/test';
// IB-134: the box's answers at 2026-11-05 14:27 UTC (T $34.9M, k 2, 2.1 days held), rebuilt with the shipped
// IB-133 functions over the box's prints plus one live 1m path per episode — the page as a member sees it today.
import box7d from './fixtures/liquidation-episodes.box-7d.json';
import box24h from './fixtures/liquidation-episodes.box-24h.json';
import collecting from '../../../libs/contracts/test/fixtures/liquidation-episodes.collecting.json';
import large from '../../../libs/contracts/test/fixtures/liquidations-large.24h.json';
import { gotoReady } from './ready';

/**
 * IB-134 acceptance (liquidation-episodes design E3–E6, E11): /liquidations as episodes at 1240 and
 * 390 — no page horizontal scroll at 390 (innerWidth asserted too: a mobile viewport widens to fit
 * an overflow), the cards one column on a phone, and the three states the box can be in: episodes
 * (2 today), none, and collecting. Full-page screenshots are attached for the side-by-side with
 * architecture/mockups/liq-episodes-2026-11-05/; `SHOT_DIR` also writes them there.
 */
const MEMBER = { user: { id: 1, tgUserId: 111, role: 'member', lang: 'ru', login: 'e2e' } };
type Variant = 'box' | 'none' | 'collecting';

/** `helpSeen`: a return visit, help collapsed — the mockup's state («ⓘ Как читать» closed); a first visit opens it (IB-120). */
async function openLiquidations(page: Page, url: string, variant: Variant = 'box', helpSeen = true): Promise<void> {
  if (helpSeen) await page.addInitScript(() => { try { localStorage.setItem('help-seen:liquidations', '1'); } catch { /* no storage: help opens */ } });
  await page.clock.install({ time: box7d.asOf * 1000 + 30_000 });
  await page.route('**/api/web/**', async (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/api/web', '');
    const period = u.searchParams.get('period') === '7d' ? '7d' : '24h';
    const query = { period, symbol: u.searchParams.get('symbol') ?? 'all', minUsd: Number(u.searchParams.get('minUsd') ?? 100_000), side: u.searchParams.get('side') ?? 'all', venue: u.searchParams.get('venue') ?? 'all' };
    const box = period === '7d' ? box7d : box24h;
    const episodes = variant === 'collecting' ? { ...collecting, asOf: box.asOf, query }
      : variant === 'none' ? { ...box, query, summary: { count: 0, shorts: 0, longs: 0, largestId: null }, episodes: [], folded: 0 }
        : { ...box, query };
    const body: Record<string, unknown> = {
      '/auth/me': MEMBER,
      '/liquidations/episodes': episodes,
      '/liquidations/large': { ...large, query },
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
  await gotoReady(page, url, { served: ['/liquidations/episodes'], ready: page.locator('app-liquidations-page h1') }); // IB-BUG-045
  await page.clock.runFor(2_000);
  await expect(page.locator('app-liquidations-page h1')).toBeVisible();
}

async function shoot(page: Page, info: import('@playwright/test').TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({ fullPage: true });
  await info.attach(name, { body, contentType: 'image/png' });
  const dir = process.env['SHOT_DIR'];
  if (dir) await page.screenshot({ fullPage: true, path: `${dir}/${name}` });
}

const widths = (page: Page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));

test.describe('liquidations — episodes at 1240 (IB-134)', () => {
  test.use({ viewport: { width: 1240, height: 900 } });

  test('the box today: 2 episodes, three columns per card, the price coin = the link coin', async ({ page }, info) => {
    await openLiquidations(page, '/liquidations?p=7d');
    const cards = page.locator('app-liq-episode-card');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.headline')).toContainText('За 7 дней — 2 эпизода: 1 раз выбивали шортов, 1 раз лонгов.');
    await expect(page.locator('.sub')).toContainText('сейчас от $35M');
    await expect(page.locator('.sub')).toContainText('норма по 2.1 дн.');
    for (const card of await cards.all()) {
      const coin = (await card.locator('.fact').first().innerText()).split(' ')[0];
      await expect(card.locator('a.open-link')).toContainText(`Открыть ${coin} в`);
      await expect(card.locator('svg path.line')).toHaveAttribute('d', /^M0 /);
    }
    // three columns side by side: the chart is to the right of the chips
    const [what, price] = await Promise.all([cards.first().locator('.what').boundingBox(), cards.first().locator('.price').boundingBox()]);
    expect(price!.x).toBeGreaterThan(what!.x + what!.width - 1);
    await shoot(page, info, 'liq-episodes-1240.png');
  });

  test('a first visit opens the help (IB-120 rule kept)', async ({ page }, info) => {
    await openLiquidations(page, '/liquidations?p=7d', 'box', false);
    await expect(page.locator('app-help-block details')).toHaveAttribute('open', '');
    await shoot(page, info, 'liq-episodes-1240-first-visit.png');
  });

  test('a tap opens the largest prints in the card', async ({ page }, info) => {
    await openLiquidations(page, '/liquidations?p=7d');
    await page.locator('app-liq-episode-card .lead').first().click();
    await expect(page.locator('app-liq-episode-card .prints li')).toHaveCount(20);
    await shoot(page, info, 'liq-episodes-1240-open.png');
  });

  test('zero episodes and collecting', async ({ page }, info) => {
    await openLiquidations(page, '/liquidations?p=24h', 'none');
    await expect(page.locator('.headline')).toHaveText('За 24 часа эпизодов не было (порог сейчас $35M).');
    await expect(page.locator('app-liq-episode-card')).toHaveCount(0);
    await shoot(page, info, 'liq-episodes-1240-none.png');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await openLiquidations(page, '/liquidations?p=24h', 'collecting');
    await expect(page.locator('.collecting')).toContainText('Копим историю для эпизодов: 17 ч.');
    await expect(page.locator('app-liq-table tbody tr')).toHaveCount(large.rows.length);
    await shoot(page, info, 'liq-episodes-1240-collecting.png');
  });
});

test.describe('liquidations — episodes at 390 (IB-134)', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  for (const [name, url, variant] of [
    ['liq-episodes-390.png', '/liquidations?p=7d', 'box'],
    ['liq-episodes-390-none.png', '/liquidations?p=24h', 'none'],
    ['liq-episodes-390-collecting.png', '/liquidations?p=24h', 'collecting'],
  ] as const) {
    test(`${name}: no page horizontal scroll, one column, no table on the main view`, async ({ page }, info) => {
      await openLiquidations(page, url, variant);
      await page.clock.runFor(1_000); // let a widened layout viewport settle before measuring
      if (variant === 'box') {
        await expect(page.locator('app-liq-episode-card')).toHaveCount(2);
        await expect(page.locator('app-liq-table')).toHaveCount(0);
        const card = page.locator('app-liq-episode-card').first();
        const [what, price] = await Promise.all([card.locator('.what').boundingBox(), card.locator('.price').boundingBox()]);
        expect(price!.y).toBeGreaterThan(what!.y + what!.height - 1); // the chart under the chips
        await page.locator('app-liq-episode-card .lead').first().tap();
        await expect(page.locator('app-liq-episode-card .prints li').first()).toBeVisible();
      }
      const w = await widths(page);
      await shoot(page, info, name);
      expect(w.innerWidth).toBe(390);
      expect(w.scrollWidth).toBeLessThanOrEqual(390);
    });
  }
});
