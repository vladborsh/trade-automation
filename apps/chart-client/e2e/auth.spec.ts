import { test, expect, type Page } from '@playwright/test';
import type { CreateInviteResponse } from '@trade-automation/contracts';
import { MOCK_ADMIN } from '../mock-server/auth';
import { apiUrl, loginAsAdmin, routeConfigTo } from './fixtures';

/**
 * backtest-app-system-design.md §2.3/§7.1 against the mock auth stub: the terminal is reachable
 * only after login, logout returns to /login, and an invite ends in a signed-in new user. These
 * tests start signed out, so they use Playwright's own `test`, not the auto-login fixture.
 */

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeEach(async ({ page }) => {
  await routeConfigTo(page);
});

test('the terminal is reachable only after login, and login returns to it', async ({ page }) => {
  await page.goto('/terminal');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fterminal$/);
  await expect(page.locator('app-terminal-shell')).toHaveCount(0);

  await signIn(page, MOCK_ADMIN.email, MOCK_ADMIN.password);
  await expect(page).toHaveURL(/\/terminal$/);
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });
});

test('a wrong password is refused with the server’s message', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, MOCK_ADMIN.email, 'not-the-password');
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.');
  await expect(page).toHaveURL(/\/login$/);
});

test('logout returns to /login and the terminal is closed again', async ({ page }) => {
  await page.goto('/login');
  await signIn(page, MOCK_ADMIN.email, MOCK_ADMIN.password);
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByTestId('current-user')).toHaveText(MOCK_ADMIN.email);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/terminal');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fterminal$/);
});

test('an invite shows its state and ends in a signed-in new user', async ({ page, request }) => {
  await loginAsAdmin(request);
  const created = await request.post(`${apiUrl()}/admin/invites`, { data: {} });
  expect(created.status()).toBe(201);
  const token = ((await created.json()) as CreateInviteResponse).url.split('/invite/')[1];
  const email = `invitee-${Date.now()}@example.com`;

  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (at least 10 characters)').fill('invitee-password');
  await page.getByLabel('Repeat password').fill('invitee-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByTestId('current-user')).toHaveText(email);
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0); // a new user is not an admin

  // Single-use: the same link now says so.
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: 'Invite already used' })).toBeVisible();
});

test('unknown and expired invites say so', async ({ page }) => {
  await page.goto('/invite/no-such-token');
  await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();

  await page.goto('/invite/mock-invite-expired');
  await expect(page.getByRole('heading', { name: 'Invite expired' })).toBeVisible();
});
