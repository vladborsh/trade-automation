import type { Session } from '@trade-automation/contracts';
import { apiUrl, expect, test } from './fixtures';

/**
 * T-029 against the mock: add a panel mid-session from the layout editor. It renders the same
 * bars at the cursor as the existing panel (the mock's tape is time-driven), and the new layout
 * survives a reload. Then remove it again.
 */
const FRIDAY_2140 = Date.UTC(2025, 2, 7, 21, 40); // 2025-03-07 was a Friday; ETHUSDT's mock history starts 2025-01-01

test('add a panel mid-session, see its bars at the cursor, keep it after a reload, remove it', async ({ page }) => {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e layout ${Date.now()}`,
      layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
      timeframe: '5m',
      periodFromMs: FRIDAY_2140,
      periodToMs: FRIDAY_2140 + 3 * 86_400_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()) as Session;

  await page.goto(`/sessions/${session.id}`);
  const cursor = page.getByTestId('replay-cursor');
  await expect(cursor).toHaveText('2025-03-07 21:40 UTC', { timeout: 15_000 });
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
  for (const expected of ['21:45', '21:50']) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`2025-03-07 ${expected} UTC`);
  }

  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByLabel('Instrument to add').selectOption({ label: 'ETH/USDT Perp' });
  await page.getByRole('button', { name: 'Add panel' }).click();

  const btc = page.locator('.chart-panel[data-panel-id="btc"] .panel-body');
  const eth = page.locator('.chart-panel[data-panel-id="binance-ethusdt"] .panel-body');
  await expect(eth).toHaveCount(1, { timeout: 15_000 });
  await expect(eth).toHaveAttribute('data-last-open', String(Date.UTC(2025, 2, 7, 21, 45)));
  await expect(eth).toHaveAttribute('data-last-open', (await btc.getAttribute('data-last-open'))!);

  await page.reload();
  await expect(page.locator('.chart-panel')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.chart-panel[data-panel-id="binance-ethusdt"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Layout' }).click();
  await page.getByTestId('layout-panel').filter({ hasText: 'binance:ETHUSDT' }).getByRole('button', { name: 'Remove panel' }).click();
  await expect(page.locator('.chart-panel')).toHaveCount(1);
  await expect(page.getByTestId('layout-error')).toHaveCount(0);
});
