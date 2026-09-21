import { test, expect } from './fixtures';

/**
 * backtest-app-system-design.md §7.2 against the mock (mock-server/backtest.ts): a session is
 * created from the form, appears in the list and is deleted after the confirm; a mixed-currency
 * selection cannot be submitted. Signed in as the mock admin by the default fixture.
 */

test('create a session, see it in the list, delete it after the confirm', async ({ page }) => {
  const name = `e2e session ${Date.now()}`;
  await page.goto('/sessions');
  await page.getByRole('link', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/sessions\/new$/);

  await page.getByLabel('Name').fill(name);
  await page.getByRole('checkbox', { name: /BTC\/USDT/ }).check();
  await expect(page.locator('input[name="periodTo"]')).toHaveValue('2026-07-01T00:00'); // end of the mock coverage: last 1m opens 23:59
  await page.getByRole('button', { name: 'Create session' }).click();

  await expect(page).toHaveURL(/\/sessions$/);
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
  await page.getByRole('checkbox', { name: /BTC\/USDT/ }).check();
  await page.getByRole('checkbox', { name: /EUR\/CHF/ }).check();

  await expect(page.getByTestId('instruments-error')).toContainText('these mix USD and CHF');
  await expect(page.getByRole('button', { name: 'Create session' })).toBeDisabled();

  await page.getByRole('checkbox', { name: /EUR\/CHF/ }).uncheck();
  await expect(page.getByTestId('instruments-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create session' })).toBeEnabled();
});
