import { apiUrl, expect, replayStarted, test } from './fixtures';

/**
 * backtest-app-system-design.md §7.2 against the mock (mock-server/backtest.ts): a session is
 * created from the form, opens its workspace (T-040), appears in the list and is deleted after the confirm; a mixed-currency
 * selection cannot be submitted. Instruments are picked in the dropdown multiselect (T-039), by
 * mouse and by keyboard. Signed in as the mock admin by the default fixture.
 */

test('create a session, land in its workspace with the chart loaded, see it in the list, delete it after the confirm', async ({ page }) => {
  const name = `e2e session ${Date.now()}`;
  await page.goto('/sessions');
  await page.getByRole('link', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/sessions\/new$/);

  await page.getByLabel('Name').fill(name);
  await page.getByTestId('instrument-trigger').click();
  await page.getByRole('option', { name: /BTC\/USDT/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('instrument-chip')).toHaveText([/BTC\/USDT Perp/]);
  await expect(page.locator('input[name="periodTo"]')).toHaveValue('2026-07-01T00:00'); // end of the mock coverage: last 1m opens 23:59
  await page.getByRole('button', { name: 'Create session' }).click();

  // T-040: straight into the new session's workspace, with its chart loaded
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  await replayStarted(page);
  await expect(page.locator('.chart-panel')).toHaveCount(1);

  await page.goto('/sessions');
  const row = page.getByTestId('session-row').filter({ hasText: name });
  await expect(row).toContainText('BTCUSDT');
  await expect(row).toContainText('10,000.00 USD');
  await expect(row).toContainText('0.00 R');

  await row.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByTestId('delete-confirm');
  await expect(confirm).toContainText('removes the session together with all its orders and screenshots');
  await expect(confirm).toContainText('cannot be undone');
  await confirm.getByRole('button', { name: 'Delete session' }).click();
  await expect(page.getByTestId('session-row').filter({ hasText: name })).toHaveCount(0);

  await page.reload(); // gone on the server, not only in the page
  await expect(page.getByTestId('session-row').filter({ hasText: name })).toHaveCount(0);
});

test('a mixed-currency selection cannot be submitted', async ({ page }) => {
  await page.goto('/sessions/new');
  await page.getByLabel('Name').fill('mixed');
  await page.getByTestId('instrument-trigger').click();
  await page.getByRole('option', { name: /BTC\/USDT/ }).click();
  await page.getByRole('option', { name: /EUR\/CHF/ }).click();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('instruments-error')).toContainText('these mix USD and CHF');
  await expect(page.getByRole('button', { name: 'Create session' })).toBeDisabled();

  // keyboard only: focus the trigger, open, search, move, toggle, close
  await page.getByTestId('instrument-trigger').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel('Search instruments')).toBeFocused(); // focus moves after the panel renders
  await page.keyboard.type('eur');
  await expect(page.getByTestId('instrument-panel').getByRole('option')).toHaveCount(1); // native <option>s elsewhere share the role
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('instrument-trigger')).toBeFocused();
  await expect(page.getByTestId('instrument-chip')).toHaveText([/BTC\/USDT Perp/]);
  await expect(page.getByTestId('instruments-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create session' })).toBeEnabled();
});

test('T-041: the play icon on a row opens that session in its workspace; a complete session has an inert one with a tooltip', async ({ page }) => {
  const request = page.context().request;
  const from = Date.UTC(2024, 2, 1, 21, 40);
  const make = async (name: string) => {
    const res = await request.post(`${apiUrl()}/backtest/sessions`, {
      data: {
        name, timeframe: '5m', periodFromMs: from, periodToMs: from + 10 * 60_000, initialBalance: 10_000, defaultRiskPct: 1,
        costs: { enabled: false, commissionPct: 0, spread: 0 },
        layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
      },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string; periodToMs: number };
  };
  const stamp = Date.now();
  const active = await make(`e2e play ${stamp}`);
  const done = await make(`e2e done ${stamp}`);
  const advanced = await request.post(`${apiUrl()}/backtest/sessions/${done.id}/advance`, { data: { opId: crypto.randomUUID(), toCursorMs: done.periodToMs } });
  expect(advanced.status()).toBe(200);

  await page.goto('/sessions');
  const doneRow = page.getByTestId('session-row').filter({ hasText: `e2e done ${stamp}` });
  await expect(doneRow).toContainText('complete');
  const inert = doneRow.getByTestId('session-play');
  await expect(inert).toHaveAttribute('aria-disabled', 'true');
  await expect(inert).toHaveAttribute('title', 'Session complete: nothing left to replay');
  await expect(doneRow.getByRole('link', { name: /Play/ })).toHaveCount(0); // not a link
  if (process.env['T041_SHOTS']) {
    await page.getByTestId('session-row').filter({ hasText: `e2e play ${stamp}` }).getByTestId('session-play').hover();
    await page.screenshot({ path: `${process.env['T041_SHOTS']}/sessions-play.png` });
  }

  await page.getByTestId('session-row').filter({ hasText: `e2e play ${stamp}` }).getByRole('link', { name: `Play e2e play ${stamp}` }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${active.id}$`));
  await replayStarted(page);
  await expect(page.getByTestId('replay-cursor')).toHaveText('2024-03-01 21:40 UTC');
});

async function createMockSession(page: import('@playwright/test').Page, name: string): Promise<{ id: string; periodToMs: number }> {
  const from = Date.UTC(2024, 2, 1, 21, 40);
  const res = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name, timeframe: '5m', periodFromMs: from, periodToMs: from + 10 * 60_000, initialBalance: 10_000, defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
      layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
    },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

test("T-042: 'Open statistics' from the list opens the stats page with the whole journal, row for row equal to GET …/orders", async ({ page }) => {
  const name = `e2e journal ${Date.now()}`;
  const s = await createMockSession(page, name);
  const orders = (await (await page.context().request.get(`${apiUrl()}/backtest/sessions/${s.id}/orders`)).json()) as Array<{ id: string; seq: number; status: string; pnlCcy: number | null }>;
  expect(orders.length).toBeGreaterThan(1);

  await page.goto('/sessions');
  const row = page.getByTestId('session-row').filter({ hasText: name });
  await expect(row.getByRole('link', { name: 'Open', exact: true })).toHaveCount(0); // the play icon replaced it
  await row.getByRole('link', { name: 'Open statistics' }).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${s.id}/stats$`));

  const journal = page.locator('app-journal');
  await expect(journal.getByTestId('journal-row')).toHaveCount(orders.length, { timeout: 15_000 });
  await expect(journal.getByTestId('journal-toggle')).toHaveCount(0); // always open on this page
  const rows = await journal.getByTestId('journal-row').evaluateAll((trs) =>
    trs.map((tr) => ({
      id: tr.getAttribute('data-order-id'),
      seq: tr.querySelector('[data-field="seq"]')?.getAttribute('data-value'),
      status: tr.querySelector('[data-field="status"]')?.getAttribute('data-value'),
      pnlCcy: tr.querySelector('[data-field="pnlCcy"]')?.getAttribute('data-value') ?? null,
    })),
  );
  const raw = (v: unknown) => (v === null || v === undefined ? null : String(v));
  expect(rows).toEqual([...orders].sort((a, b) => a.seq - b.seq).map((o) => ({ id: o.id, seq: String(o.seq), status: o.status, pnlCcy: raw(o.pnlCcy) })));

  if (process.env['T042_SHOTS']) {
    await journal.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env['T042_SHOTS']}/stats-journal.png`, fullPage: true });
  }
  // a row links to its trade detail
  const first = [...orders].sort((a, b) => a.seq - b.seq)[0];
  await journal.locator(`[data-order-id="${first.id}"] [data-field="seq"] a`).click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${s.id}/trades/${first.id}$`));
});

test('T-042: at 1280 px a long session name still fits the sessions table — no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const LONG_NAME = 'London open breakout — BTC & ETH practice 2024'; // a fixed, realistic long name (46 chars)
  const s = await createMockSession(page, LONG_NAME);
  await page.context().request.post(`${apiUrl()}/backtest/sessions/${s.id}/advance`, { data: { opId: crypto.randomUUID(), toCursorMs: s.periodToMs } }); // complete: the widest status
  await page.goto('/sessions');
  await expect(page.getByTestId('session-row').filter({ hasText: LONG_NAME }).first()).toBeVisible();
  const fit = await page.evaluate(() => {
    const w = document.querySelector('.table-scroll')!;
    return { scrollW: w.scrollWidth, clientW: w.clientWidth };
  });
  expect(fit.scrollW, `table ${fit.scrollW}px in a ${fit.clientW}px container`).toBeLessThanOrEqual(fit.clientW);
  if (process.env['T042_SHOTS']) await page.screenshot({ path: `${process.env['T042_SHOTS']}/sessions-1280.png` });
});
