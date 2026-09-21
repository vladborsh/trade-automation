import type { Page } from '@playwright/test';
import type { Session } from '@trade-automation/contracts';
import { apiUrl, expect, test } from './fixtures';

/**
 * T-028 against the mock: indicators added from the picker render on the panel (an overlay line and
 * separate-pane oscillators), survive a timeframe switch and a reload (they live in the session's
 * layout copy), and disappear when removed. T-034: the five lifted indicators reach the picker from
 * the catalogue alone and draw.
 */
const FRIDAY_2140 = Date.UTC(2025, 2, 7, 21, 40);

async function openSession(page: Page): Promise<void> {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e indicators ${Date.now()}`,
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
  await expect(page.getByTestId('replay-cursor')).toHaveText('2025-03-07 21:40 UTC', { timeout: 15_000 });
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
}

async function addIndicator(page: Page, name: string): Promise<void> {
  await page.getByLabel('Indicator to add').selectOption({ label: name });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test('overlay and separate-pane indicators: render, survive a tf switch and a reload, go when removed', async ({ page }) => {
  await openSession(page);
  const cursor = page.getByTestId('replay-cursor');
  const chart = page.locator('.chart-panel[data-panel-id="btc"] [data-indicator-series-count]');
  await expect(chart).toHaveAttribute('data-indicator-series-count', '0');

  await page.getByRole('button', { name: 'Layout' }).click();
  const add = (name: string) => addIndicator(page, name);
  await add('Exponential moving average');
  await expect(chart).toHaveAttribute('data-indicator-series-count', '1');
  await add('Relative strength index');
  await add('MACD');
  await expect(chart).toHaveAttribute('data-indicator-series-count', '5'); // EMA + RSI + MACD's 3 lines
  await expect(page.getByTestId('indicator-row')).toHaveCount(3);

  // a parameter edit keeps the instance
  await page.getByLabel('EMA (20) Length').fill('9');
  await page.getByLabel('EMA (20) Length').press('Tab');
  await expect(page.getByTestId('indicator-row').first()).toContainText('EMA (9)');

  // a timeframe switch recomputes, nothing is lost
  await page.getByRole('button', { name: 'Layout' }).click(); // close the editor, keys go to the workspace
  await page.keyboard.press(']');
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
  await expect(chart).toHaveAttribute('data-indicator-series-count', '5');

  // persisted in the session's layout copy
  await page.reload();
  await expect(cursor).toHaveText('2025-03-07 21:40 UTC', { timeout: 15_000 });
  await expect(page.locator('.chart-panel[data-panel-id="btc"] [data-indicator-series-count]')).toHaveAttribute('data-indicator-series-count', '5', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Layout' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remove indicator' }).first().click();
  await expect(page.getByTestId('indicator-row')).toHaveCount(0);
  await expect(page.locator('.chart-panel[data-panel-id="btc"] [data-indicator-series-count]')).toHaveAttribute('data-indicator-series-count', '0');
});

test('T-034: the five lifted indicators come from the catalogue and draw', async ({ page }) => {
  await openSession(page);
  const chart = page.locator('.chart-panel[data-panel-id="btc"] [data-indicator-series-count]');
  await page.getByRole('button', { name: 'Layout' }).click();
  for (const name of [
    'VWAP band (UTC day from 00:01, ±1σ)',
    'Average true range',
    'Range high / low (bars before the current one)',
    'Previous UTC hour high / low',
    'Inverse FVG (latest)',
  ]) {
    await addIndicator(page, name);
  }
  await expect(page.getByTestId('indicator-row')).toHaveCount(5);
  await expect(chart).toHaveAttribute('data-indicator-series-count', '11'); // 3 + 1 + 3 + 2 + 2 lines
});
