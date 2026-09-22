import type { Order, Session, SessionDetail } from '@trade-automation/contracts';
import { apiUrl, expect, openJournal, replayStarted, test } from './fixtures';

/**
 * T-030 / design §9.3 against the mock: journal → trade detail (row, modifications, screenshot or
 * placeholder) → "Show on chart" (view-only: read-only toolbar, → inert, timeframe switch not
 * persisted) → back, and the session's cursor on the server has not moved.
 */

test('trade detail, show on chart view-only, and the session cursor is untouched', async ({ page }) => {
  const request = page.context().request;
  const from = Date.UTC(2024, 2, 1, 10);
  const created = await request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e detail ${Date.now()}`, timeframe: '5m', periodFromMs: from, periodToMs: Date.UTC(2024, 2, 2), initialBalance: 10_000,
      defaultRiskPct: 1, costs: { enabled: false, commissionPct: 0, spread: 0 },
      layout: { id: 'd', name: 'D', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
    },
  });
  const session = (await created.json()) as Session;
  // Put the seeded trades in the past: the session has been stepped to 12:00.
  const advanced = await request.post(`${apiUrl()}/backtest/sessions/${session.id}/advance`, {
    data: { opId: crypto.randomUUID(), toCursorMs: Date.UTC(2024, 2, 1, 12) },
  });
  expect(advanced.status()).toBe(200);
  const cursorBefore = ((await (await request.get(`${apiUrl()}/backtest/sessions/${session.id}`)).json()) as SessionDetail).session.cursorMs;
  const orders = (await (await request.get(`${apiUrl()}/backtest/sessions/${session.id}/orders`)).json()) as Order[];
  const first = orders[0];

  // Journal → detail
  await page.goto(`/sessions/${session.id}`);
  await openJournal(page); // T-043: collapsed by default
  await page.getByTestId('journal-row').first().locator('[data-field="seq"] a').click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}/trades/${first.id}$`));
  await expect(page.locator('h1')).toContainText('Trade #1');
  await expect(page.locator('[data-field="pnlCcy"]')).toHaveAttribute('data-value', String(first.pnlCcy));
  await expect(page.locator('[data-shot="entry"] img')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('[data-shot="exit"] [data-testid="shot-placeholder"]')).toBeVisible();

  // Show on chart → view-only at the revealed entry candle
  const mutations: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && r.url().includes('/api/backtest/')) mutations.push(`${r.method()} ${r.url()}`);
  });
  await page.getByTestId('show-on-chart').click();
  const viewAt = (first.entryTimeMs as number) + 60_000;
  await expect(page).toHaveURL(new RegExp(`viewAt=${viewAt}&order=${first.id}`));
  const viewing = page.getByTestId('replay-viewing');
  await expect(viewing).toHaveText(`viewing ${new Date(viewAt).toISOString().slice(0, 16).replace('T', ' ')} UTC — read only`, { timeout: 15_000 });
  await expect(page.getByTestId('replay-step')).toBeDisabled();
  await replayStarted(page); // the keys below act only once the view's history is in (BUG-009)
  const cursorText = await page.getByTestId('replay-cursor').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('replay-cursor')).toHaveText(cursorText!);
  await page.keyboard.press(']'); // 5m → 15m, allowed, not persisted
  await expect(page.locator('.tf-btn.active')).toHaveText('15m');

  // Back to the session: normal mode at the persisted cursor
  await page.getByTestId('replay-back').click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.id}$`));
  await expect(page.getByTestId('replay-viewing')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('replay-cursor')).toHaveText('2024-03-01 12:00 UTC');

  expect(mutations).toEqual([]);
  const after = ((await (await request.get(`${apiUrl()}/backtest/sessions/${session.id}`)).json()) as SessionDetail).session;
  expect(after.cursorMs).toBe(cursorBefore);
  expect(after.timeframe).toBe('5m'); // the view's 15m was never persisted
});
