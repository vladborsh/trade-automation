import type { Session, SessionStatsResponse } from '@trade-automation/contracts';
import { apiUrl, expect, test } from './fixtures';

/**
 * T-032 against the mock's fixed journal: the full statistics screen shows `GET …/stats`.computed —
 * every figure (compared on the raw `data-value`) and every equity-curve point, one for one.
 */

/** `pnl` → computed.pnl; `byInstrument.binance:BTCUSDT.pnl` → computed.byInstrument['binance:BTCUSDT'].pnl. */
function statValue(s: SessionStatsResponse['computed'], key: string): unknown {
  const breakdown = /^(byInstrument|bySide)\.(.+)\.(\w+)$/.exec(key);
  if (!breakdown) return (s as unknown as Record<string, unknown>)[key];
  const [, group, id, field] = breakdown;
  return (s[group as 'byInstrument'] as Record<string, Record<string, unknown>>)[id][field];
}

test('the full statistics screen equals GET …/stats, figure for figure and point for point', async ({ page }) => {
  const request = page.context().request;
  const created = await request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e stats ${Date.now()}`, timeframe: '5m', periodFromMs: Date.UTC(2024, 2, 1, 10), periodToMs: Date.UTC(2024, 2, 2), initialBalance: 10_000,
      defaultRiskPct: 1, costs: { enabled: false, commissionPct: 0, spread: 0 },
      layout: { id: 's', name: 'S', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
    },
  });
  const session = (await created.json()) as Session;
  const { computed } = (await (await request.get(`${apiUrl()}/backtest/sessions/${session.id}/stats`)).json()) as SessionStatsResponse;

  // From the workspace's summary to the full screen.
  await page.goto(`/sessions/${session.id}`);
  await page.getByTestId('stats-full-link').click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/stats$`));
  await expect(page.locator('h1')).toContainText('Статистика', { timeout: 15_000 });

  const raw = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const figures = await page.locator('[data-stat]').all();
  expect(figures.length).toBeGreaterThan(20);
  for (const f of figures) {
    const key = (await f.getAttribute('data-stat'))!;
    expect(await f.getAttribute('data-value'), key).toBe(raw(statValue(computed, key)));
  }

  const points = page.locator('[data-testid="equity-points"] li');
  await expect(points).toHaveCount(computed.equityCurve.length);
  for (const [i, p] of computed.equityCurve.entries()) {
    await expect(points.nth(i)).toHaveAttribute('data-time', String(p.time));
    await expect(points.nth(i)).toHaveAttribute('data-balance', String(p.balance));
    await expect(points.nth(i)).toHaveAttribute('data-balance-r', String(p.balanceR));
  }
  await expect(page.locator('[data-testid="equity-chart"] canvas').first()).toBeVisible();
  await expect(page.getByTestId('pessimistic-callout')).toContainText('посчитаны по барам');

  await page.getByRole('button', { name: 'R', exact: true }).click(); // the R view of the same curve
  await expect(page.getByRole('button', { name: 'R', exact: true })).toHaveClass(/active/);
});
