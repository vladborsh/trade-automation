import { expect, test, type Page } from '@playwright/test';
import cards from './fixtures/context-cards.json';
import insights from './fixtures/market-insights.24h.json';
import kpis from './fixtures/market-kpis.json';
import overview from './fixtures/liquidations-overview.24h.json';

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
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
}

async function openMarket(page: Page): Promise<void> {
  await page.clock.install({ time: overview.asOf * 1000 + 30_000 });
  await mockApi(page);
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

  test('one column: every card starts at the same left edge', async ({ page }) => {
    await openMarket(page);
    const lefts = await page.locator('app-market .cards > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
  });

  test('the period switch puts the period in the URL and asks for it', async ({ page }) => {
    await openMarket(page);
    const asked = page.waitForRequest((r) => r.url().includes('/market/insights') && r.url().includes('period=1h'));
    await page.getByRole('button', { name: '1h' }).click();
    await page.clock.runFor(500);
    await asked;
    await expect(page).toHaveURL(/[?&]p=1h/);
    await expect(page.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
  });
});

test.describe('market page — desktop 1440×900 (IB-088)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('no horizontal scroll, and the screenshot', async ({ page }, info) => {
    await openMarket(page);
    const m = await measure(page);
    await info.attach('desktop-1440.png', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect(m.scrollWidth).toBeLessThanOrEqual(1440);
    expect(m.small).toEqual([]);
  });
});
