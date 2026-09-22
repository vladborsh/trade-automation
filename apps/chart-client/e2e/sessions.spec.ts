import { expect, replayStarted, test } from './fixtures';

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
