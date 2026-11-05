import { expect, test, type Page, type TestInfo } from '@playwright/test';
import cards from './fixtures/context-cards.json';
import kpis from './fixtures/market-kpis.json';
import overview from './fixtures/liquidations-overview.24h.json';
import positioning from './fixtures/market-positioning.24h.json';
import caps24h from './fixtures/market-caps.24h.json';
// IB-119: the mockup's two cards (TRUMP funding R5, BNB OI vs price R4) plus an R3 cascade. SYNTHETIC
// series in the contract's shape (built by the IB-119 fixture script, schema-checked), not a capture:
// the acceptance is a side-by-side with the mockup, so the data mirrors the mockup's.
import insights from './fixtures/market-insights-charts.24h.json';
import flows from '../../../libs/contracts/test/fixtures/flows.24h.json';
import { gotoReady } from './ready';

/**
 * IB-119 acceptance (market round 2 §3): every «Главное сейчас» card is two columns at 1240 — text
 * left, a real chart right (≈ 55 / 45) — and stacks at 390, chart under the text; each chart has a
 * y axis with 3–5 ticks, the reference line, the span named, the current value printed, a one-line
 * legend; no page horizontal scroll. `E2E_SHOTS` (a folder) also writes the report's screenshots.
 */
const MEMBER = { user: { id: 1, tgUserId: 111, role: 'member', lang: 'ru', login: 'e2e' } };

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/web/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/web', '');
    const period = url.searchParams.get('period') ?? '24h';
    const body: Record<string, unknown> = {
      '/auth/me': MEMBER,
      '/context/cards': cards,
      '/market/kpis': kpis,
      '/market/insights': { ...insights, period },
      '/liquidations/overview': { ...overview, block: { ...overview.block, period } },
      '/calendar/upcoming': { events: [] },
      '/market/positioning': { ...positioning, period },
      '/market/caps': { ...caps24h, period },
      '/market/flows': { ...flows, period },
    };
    if (path in body) await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body[path]) });
    else await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: path }) });
  });
}
async function shot(info: TestInfo, name: string, body: Buffer): Promise<void> {
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env['E2E_SHOTS']) (await import('node:fs')).writeFileSync(`${process.env['E2E_SHOTS']}/${name}`, body);
}

for (const [width, height] of [[1240, 900], [390, 844]] as const) {
  test.describe(`IB-119 insight cards with a real chart — ${width}`, () => {
    test.use({ viewport: { width, height } });

    test('every card carries its chart, laid out per width, with axis, reference, span, value and legend', async ({ page }, info) => {
      await page.clock.install({ time: overview.asOf * 1000 + 30_000 });
      await mockApi(page);
      const block = page.locator('app-insights-block');
      const items = block.locator('app-insight-card');
      // IB-BUG-045: wait for the insights answer and the third card, not for 5 s after `load`
      await gotoReady(page, '/market?p=24h', { served: ['/market/insights'], ready: items.nth(2) });
      await page.clock.runFor(2_000);
      await expect(items).toHaveCount(3);

      for (let i = 0; i < 3; i++) {
        const card = items.nth(i);
        const text = (await card.locator('.text').boundingBox())!;
        const chart = (await card.locator('app-insight-chart').boundingBox())!;
        if (width === 1240) {
          // side by side, the chart ≈ 45 % of the card
          expect(chart.x).toBeGreaterThan(text.x + text.width - 1);
          expect(Math.abs(chart.y - text.y)).toBeLessThan(2);
          const share = chart.width / (chart.x + chart.width - text.x);
          expect(share).toBeGreaterThan(0.38);
          expect(share).toBeLessThan(0.5);
          // the legend is one line
          expect((await card.locator('.legend').boundingBox())!.height).toBeLessThan(20);
        } else {
          expect(chart.y).toBeGreaterThan(text.y + text.height - 1);
          expect(Math.abs(chart.width - text.width)).toBeLessThan(2);
        }
        const ticks = await card.locator('.yaxis .num').count();
        expect(ticks).toBeGreaterThanOrEqual(3);
        expect(ticks).toBeLessThanOrEqual(5);
        await expect(card.locator('line.ref')).toHaveCount(1);
        await expect(card.locator('.xaxis .x')).toHaveCount(3);
        await expect(card.locator('.corner .num').first()).not.toBeEmpty();
        expect(await card.locator('.legend .key').count()).toBeGreaterThan(0);
      }

      // the mockup's two cards, in its words and numbers
      const r5 = items.nth(0);
      await expect(r5.locator('.caption')).toHaveText('Фандинг TRUMP, 30 дней (каждая выплата)');
      await expect(r5.locator('.corner')).toContainText('−0.0332 %');
      await expect(r5.locator('.xaxis .x')).toHaveText(['−30д', '−15д', 'сейчас']);
      expect(await r5.locator('.bar.out').count()).toBeGreaterThan(0);
      expect(await r5.locator('.bar.in').count()).toBeGreaterThan(0);
      await expect(r5.locator('a.link')).toHaveAttribute('href', '/positioning?p=24h');
      const r4 = items.nth(1);
      await expect(r4.locator('.caption')).toHaveText('BNB за 24ч, изменение от начала, %');
      await expect(r4.locator('.corner .val .name')).toHaveText(['цена', 'OI']);
      await expect(r4.locator('.corner .val .num')).toHaveText(['+1.8 %', '−4.1 %']);
      await expect(r4.locator('.xaxis .x')).toHaveText(['−24ч', '−12ч', 'сейчас']);

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await block.scrollIntoViewIfNeeded();
      await shot(info, `insights-${width}.png`, await block.screenshot());
    });
  });
}
