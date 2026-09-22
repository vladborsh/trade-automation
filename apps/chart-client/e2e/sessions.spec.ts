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
