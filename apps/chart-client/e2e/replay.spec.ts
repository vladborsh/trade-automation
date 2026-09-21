import type { Session } from '@trade-automation/contracts';
import { apiUrl, expect, test } from './fixtures';

/**
 * backtest-app-system-design.md §5.4 against the mock's deterministic tape (mock-server/
 * replay-tape.ts): open a session, step five times, switch the timeframe mid-bar — the cursor
 * stays and the newest bar is the partially formed one. Signed in as the mock admin.
 */

const FRIDAY_2140 = Date.UTC(2024, 2, 1, 21, 40); // 2024-03-01 was a Friday

test('open a session, step five times, switch timeframe mid-bar', async ({ page }) => {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e replay ${Date.now()}`,
      layout: {
        id: 'replay-e2e',
        name: 'Replay e2e',
        grid: { columns: 1, rows: 1 },
        panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
      },
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
  const body = page.locator('.chart-panel[data-panel-id="btc"] .panel-body');
  await expect(cursor).toHaveText('2024-03-01 21:40 UTC', { timeout: 15_000 });
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });

  for (const expected of ['21:45', '21:50', '21:55', '22:00', '22:05']) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`2024-03-01 ${expected} UTC`);
  }
  // On a 5m boundary the newest bar is the one that just closed.
  await expect(body).toHaveAttribute('data-last-open', String(Date.UTC(2024, 2, 1, 22, 0)));
  await expect(body).toHaveAttribute('data-last-closed', 'true');

  // ] → 15m: the cursor stays at 22:05, and the 22:00 bar is shown partially formed.
  const history = page.waitForResponse((r) => r.url().includes('/candles?') && r.url().includes('timeframe=15m'));
  await page.keyboard.press(']');
  // History only up to the server's cursor (still 21:40 until T-021): the 15m boundary at or before it;
  // the rest of the forming bar is folded from 1m on the client.
  expect(new URL((await history).url()).searchParams.get('before')).toBe(String(Date.UTC(2024, 2, 1, 21, 30)));
  await expect(page.locator('.tf-btn.active')).toHaveText('15m');
  await expect(cursor).toHaveText('2024-03-01 22:05 UTC');
  await expect(body).toHaveAttribute('data-last-open', String(Date.UTC(2024, 2, 1, 22, 0)));
  await expect(body).toHaveAttribute('data-last-closed', 'false');

  // …and it keeps forming as the cursor moves on inside it.
  await page.keyboard.press('ArrowRight');
  await expect(cursor).toHaveText('2024-03-01 22:15 UTC');
  await expect(body).toHaveAttribute('data-last-closed', 'true');
});
