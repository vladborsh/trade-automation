import type { Page } from '@playwright/test';
import type { Order, Session, SessionStatsResponse } from '@trade-automation/contracts';
import { apiUrl, expect, openJournal, test } from './fixtures';

/**
 * T-024 against the mock's fixed journal (mock-server/journal-seed.ts): the journal rows equal
 * `GET …/orders` field for field and the summary equals `GET …/stats`.computed, compared on the
 * raw server values each cell carries (`data-value`), not on formatted text.
 */

async function createSession(page: Page, name: string): Promise<Session> {
  const res = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name, timeframe: '5m', periodFromMs: Date.UTC(2024, 2, 1, 10), periodToMs: Date.UTC(2024, 2, 2), initialBalance: 10_000,
      defaultRiskPct: 1, costs: { enabled: true, commissionPct: 0.05, spread: 0.5 },
      layout: { id: 'j', name: 'J', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as Session;
}

const asRaw = (v: unknown) => (v === null || v === undefined ? null : String(v));

test('the journal rows and the summary are the server\'s, field for field', async ({ page }) => {
  const session = await createSession(page, `e2e journal ${Date.now()}`);
  const orders = (await (await page.context().request.get(`${apiUrl()}/backtest/sessions/${session.id}/orders`)).json()) as Order[];
  const stats = (await (await page.context().request.get(`${apiUrl()}/backtest/sessions/${session.id}/stats`)).json()) as SessionStatsResponse;

  await page.goto(`/sessions/${session.id}`);
  await openJournal(page); // T-043: collapsed by default
  const rows = page.getByTestId('journal-row');
  await expect(rows).toHaveCount(orders.length, { timeout: 15_000 });

  for (const [i, order] of orders.entries()) {
    const row = rows.nth(i);
    await expect(row).toHaveAttribute('data-order-id', order.id);
    for (const cell of await row.locator('td[data-field]').all()) {
      const field = (await cell.getAttribute('data-field')) as keyof Order;
      expect(await cell.getAttribute('data-value'), `${order.id}.${field}`).toBe(asRaw(order[field]));
    }
  }

  for (const item of await page.locator('[data-stat]').all()) {
    const key = (await item.getAttribute('data-stat')) as keyof SessionStatsResponse['computed'];
    expect(await item.getAttribute('data-value'), `stats.${key}`).toBe(asRaw(stats.computed[key]));
  }
  await expect(page.locator('[data-stat="trades"] dd')).toHaveText(String(stats.computed.trades));
  await expect(page.getByTestId('stats-drift')).toHaveCount(0);

  // Each flag is visible and explained.
  await expect(page.locator('.flag[data-flag="pessimistic-bar"]')).toHaveAttribute('title', 'Resolved on bars, not 1m: stop assumed first');
  await expect(page.locator('.flag[data-flag="sl-tp-same-bar"]')).toHaveAttribute('title', 'SL and TP in one candle — stop taken');
  await expect(page.locator('.flag[data-flag="end-of-session"]')).toHaveAttribute('title', /end of the session/);
});

test('the summary says when the stored aggregates drifted', async ({ page }) => {
  const session = await createSession(page, `e2e drift ${Date.now()}`);
  await page.goto(`/sessions/${session.id}`);
  await expect(page.getByTestId('stats-drift')).toContainText('Stored aggregates differ', { timeout: 15_000 });
});

test('T-043: the journal is collapsed by default; the toggle opens and closes it, remembered across a reload', async ({ page }) => {
  const session = await createSession(page, `e2e journal toggle ${Date.now()}`);
  const toggle = page.getByTestId('journal-toggle');
  const rows = page.getByTestId('journal-row');

  await page.goto(`/sessions/${session.id}`);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
  await expect(toggle).toContainText(/Journal \(\d+\)/);
  await expect(rows).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(rows.first()).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
  await expect(rows.first()).toBeVisible();

  await toggle.click();
  await expect(rows).toHaveCount(0);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 15_000 });
  await expect(rows).toHaveCount(0);
});
