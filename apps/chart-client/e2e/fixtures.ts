import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { MOCK_ADMIN } from '../mock-server/auth';
import { MOCK_PORT } from './ports';

export { DEEP_HISTORY_MOCK_PORT, FROZEN_MOCK_PORT, MOCK_PORT, TAIL_GAP_MOCK_PORT } from './ports';

// Shared e2e fixtures: ports (./ports), the mock's runtime config, and a signed-in page.

export function apiUrl(port: number = MOCK_PORT): string {
  return `http://localhost:${port}/api`;
}

export function wsUrl(port: number = MOCK_PORT): string {
  return `ws://localhost:${port}/ws`;
}

/** Points this page's runtime config at a mock instance (the last registered route wins). */
export async function routeConfigTo(page: Page, port: number = MOCK_PORT): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: apiUrl(port), wsUrl: wsUrl(port) }) }),
  );
}

/**
 * Signs `request` in as the mock's fixed admin. The `bt_session` cookie lands in that
 * context's jar; cookies are not port-scoped and the mock accepts its sessions on every
 * instance, so one login covers :MOCK_PORT and its +1/+2 siblings.
 */
export async function loginAsAdmin(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${apiUrl()}/auth/login`, { data: MOCK_ADMIN });
  expect(res.status(), 'mock admin login').toBe(200);
}

/**
 * The default fixtures for every terminal/calendar spec: the page is already signed in
 * (backtest-app-system-design.md §7.1 puts the whole app behind login) and its config points
 * at the default mock instance. Specs for the auth flow itself import `test` from
 * '@playwright/test' instead and use `routeConfigTo` directly.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await routeConfigTo(page);
    await loginAsAdmin(page.context().request);
    await use(page);
  },
  request: async ({ request }, use) => {
    await loginAsAdmin(request);
    await use(request);
  },
});

/**
 * Waits until the workspace's replay engine has its first history in (`data-replay-started`,
 * BUG-010). Unlike `replay-loading` having count 0 — also true before the toolbar has rendered
 * at all — this cannot pass early, so a hover or click after it meets a chart with bars.
 */
export async function replayStarted(page: Page): Promise<void> {
  await expect(page.locator('.workspace[data-replay-started]')).toHaveCount(1, { timeout: 15_000 });
}

export { expect };
