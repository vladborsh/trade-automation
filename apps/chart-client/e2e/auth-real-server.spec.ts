import { test, expect, type Page } from '@playwright/test';
import { CLIENT_PORT } from './ports';

/**
 * Tester e2e (cluster bt-auth): the auth critical flow against the REAL signal-server, not the
 * mock. What only a real server can prove and the mock-based auth.spec / admin.spec cannot:
 * the httpOnly `bt_session` cookie set by :API_PORT is accepted by a page served from
 * :CLIENT_PORT (SameSite=Lax across ports, CORS `credentials: true`), and a disable performed by
 * the admin really invalidates the invitee's next request server-side.
 *
 * Skipped unless REAL_API_PORT is set (a signal-server on that port, DATABASE_URL configured, CORS_ORIGIN
 * = the client origin) together with REAL_ADMIN_EMAIL / REAL_ADMIN_PASSWORD:
 *   REAL_API_PORT=3040 REAL_ADMIN_EMAIL=… REAL_ADMIN_PASSWORD=… E2E_CLIENT_PORT=4240 npx playwright test e2e/auth-real-server.spec.ts
 * (with a client dev server already on E2E_CLIENT_PORT; the mock webServers of the config still start
 * and are simply unused).
 */
const API_PORT = process.env['REAL_API_PORT'];
const ADMIN_EMAIL = process.env['REAL_ADMIN_EMAIL'] ?? '';
const ADMIN_PASSWORD = process.env['REAL_ADMIN_PASSWORD'] ?? '';
test.skip(!API_PORT || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'REAL_API_PORT / REAL_ADMIN_EMAIL / REAL_ADMIN_PASSWORD not set');

const api = (p: string) => `http://localhost:${API_PORT}/api${p}`;

async function pointAtRealServer(page: Page): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: api(''), wsUrl: `ws://localhost:${API_PORT}` }) }),
  );
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('real server: login honours a safe returnUrl and sanitises hostile ones', async ({ page }) => {
  await pointAtRealServer(page);
  const hostile = ['//evil.example', 'https://evil.example', '/login', '/\\evil.example', 'javascript:alert(1)', '/invite/abc'];
  for (const returnUrl of hostile) {
    await page.context().clearCookies();
    await page.goto(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page, `returnUrl ${returnUrl}`).toHaveURL(`http://localhost:${CLIENT_PORT}/sessions`);
  }
  await page.context().clearCookies();
  await page.goto('/login?returnUrl=%2Fadmin%2Fusers');
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/admin\/users$/);
});

test('real server: invite → accept → /sessions but not /admin/users → disable → next request is 401 → logout by hard reload', async ({
  page,
  browser,
}) => {
  await pointAtRealServer(page);
  await page.goto('/login');
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/sessions$/); // the login round trip must finish before navigating away
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Create invite' }).click();
  const link = page.getByRole('textbox', { name: 'Invite link' });
  const url = await link.inputValue();
  expect(url).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

  const guest = await browser.newContext();
  const invitee = await guest.newPage();
  await pointAtRealServer(invitee);
  const email = `real-${Date.now()}@bt-e2e.test`;
  await invitee.goto(new URL(url).pathname);
  await invitee.getByLabel('Email').fill(email);
  await invitee.getByLabel('Password (at least 10 characters)').fill('invitee-password');
  await invitee.getByLabel('Repeat password').fill('invitee-password');
  await invitee.getByRole('button', { name: 'Create account' }).click();
  await expect(invitee).toHaveURL(/\/sessions$/);

  // the cookie the real server set works cross-port for the REST API the app calls
  const me = await guest.request.get(api('/auth/me'));
  expect(me.status()).toBe(200);
  expect((await me.json()).user.role).toBe('user');
  expect((await guest.request.get(api('/admin/users'))).status()).toBe(403);
  await invitee.goto('/admin/users');
  await expect(invitee).toHaveURL(/\/sessions$/);

  // the once-only invite URL is gone after a reload, and the used invite cannot be reused
  await page.goto('/admin/users');
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);
  const reuse = await guest.request.post(api(`/auth/invites/${url.split('/invite/')[1]}/accept`), {
    data: { email: `again-${Date.now()}@bt-e2e.test`, password: 'invitee-password' },
  });
  expect(reuse.status()).toBe(410);

  const row = page.getByTestId(`user-${email}`);
  await row.getByRole('button', { name: 'Disable' }).click();
  await row.getByRole('button', { name: 'Confirm disable' }).click();
  await expect(row).toContainText('disabled');

  expect((await guest.request.get(api('/auth/me'))).status(), 'the disabled user’s next request').toBe(401);
  await invitee.goto('/sessions');
  await expect(invitee).toHaveURL(/\/login/);
  await guest.close();

  // logout is a hard reload: nothing of the session survives, /terminal is closed again
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/terminal');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fterminal$/);
});
