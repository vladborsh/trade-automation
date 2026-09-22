import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
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

/**
 * BUG-007: the plot area of a panel's chart — its pane canvas, the largest one — WITHOUT the
 * price axis. A drag must start inside it to pan: the container also holds the ~80 px price
 * axis, and a drag starting there rescales prices instead (the right-edge pan below used to
 * start at 0.8 of the container, on the axis, and passed only because a live bar moved `to`).
 */
export async function plotBox(container: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const boxes = await container.locator('canvas').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  return boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

/** T-043: the workspace journal is collapsed by default; opens it (a no-op when already open). */
export async function openJournal(page: Page): Promise<void> {
  const toggle = page.getByTestId('journal-toggle');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

export { expect };
