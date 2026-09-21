import { expect, routeConfigTo, test } from './fixtures';

/**
 * T-010 — the admin users/invites page against the mock (backtest-app-system-design.md §7.1,
 * decision 30): create an invite → the one-time URL is shown → it is accepted in a fresh browser
 * context → the new user appears → a non-admin cannot open the page → disable → the new user's
 * session is rejected. The auto-login fixture signs `page` in as the mock admin.
 */
test('admin: invite → accept in a fresh context → user listed → disable rejects their session', async ({ page, browser }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users and invites' })).toBeVisible();

  await page.getByRole('button', { name: 'Create invite' }).click();
  const link = page.getByRole('textbox', { name: 'Invite link' });
  await expect(link).toBeVisible();
  await expect(page.getByText('shown only this once')).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

  // the invitee, in a fresh context (no admin cookie)
  const guest = await browser.newContext();
  const invitee = await guest.newPage();
  await routeConfigTo(invitee);
  const email = `invitee-${Date.now()}@example.com`;
  await invitee.goto(new URL(url).pathname);
  await invitee.getByLabel('Email').fill(email);
  await invitee.getByLabel('Password (at least 10 characters)').fill('invitee-password');
  await invitee.getByLabel('Repeat password').fill('invitee-password');
  await invitee.getByRole('button', { name: 'Create account' }).click();
  await expect(invitee).toHaveURL(/\/sessions$/);

  // a non-admin is sent away from the admin page
  await invitee.goto('/admin/users');
  await expect(invitee).toHaveURL(/\/sessions$/);

  // back on the admin page: after a reload the URL is gone for good, the new user is listed
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);
  const row = page.getByTestId(`user-${email}`);
  await expect(row).toContainText('active');

  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row).toContainText('signs');
  await row.getByRole('button', { name: 'Confirm disable' }).click();
  await expect(row).toContainText('disabled');

  // the invitee's session is rejected on their next navigation
  await invitee.goto('/sessions');
  await expect(invitee).toHaveURL(/\/login/);
  await guest.close();
});
