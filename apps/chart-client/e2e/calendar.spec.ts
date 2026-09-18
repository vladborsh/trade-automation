import { test, expect } from '@playwright/test';

/**
 * architecture/economic-calendar.md §10 SE-CAL-2's e2e proof: boots on the
 * charts view, receives a synthetic `notification` frame from the mock
 * server → a toast becomes visible → clicking it switches to the calendar
 * view with the corresponding row highlighted; the `c` shortcut toggles
 * views; calendar filters persist across a page reload; the sound-alert
 * arm affordance (§11.5).
 */

/**
 * §11.2 — the default filters (USD/EUR/GBP, medium/high/holiday) hide some
 * fixture rows, and the mock's synthetic notification is about whichever
 * event is nearest "now". Tests that need every row visible start from an
 * everything-selected v2 filter set.
 */
async function showEverything(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chart-client:calendar-filters:v2',
      JSON.stringify({
        impacts: ['medium', 'high', 'holiday', 'low', 'unknown'],
        countries: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'],
        hideRemoved: false,
      }),
    );
  });
}

test('boots on the charts view, shows a toast from the mock notification frame, and clicking it opens the calendar view with the row highlighted', async ({
  page,
}) => {
  await showEverything(page);
  await page.goto('/');

  // Default view: the panel grid, not the calendar table.
  await expect(page.locator('app-panel-grid')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-week"]')).toHaveCount(0);

  // The mock server's synthetic `notification` frame (playwright.config.ts speeds this
  // up to ~1s + a short interval for e2e) arrives over the `calendar` WS topic, which is
  // subscribed at boot regardless of the active view (§7.1) — the toast must show here,
  // on the charts view.
  const toast = page.locator('.toast').first();
  await expect(toast).toBeVisible({ timeout: 15_000 });

  await toast.click();

  // Clicking the toast switches to the calendar view and highlights the event it was about.
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.event-row.highlighted')).toHaveCount(1, { timeout: 10_000 });
});

test('the "c" key toggles between the charts and calendar views', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-panel-grid')).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible();

  await page.keyboard.press('c');
  await expect(page.locator('[data-testid="calendar-week"]')).toHaveCount(0);
  await expect(page.locator('app-panel-grid')).toBeVisible();
});

test('calendar filters persist across a page reload', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('c');
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible();

  // §11.2 defaults on a fresh profile: holiday on, low off
  const holiday = page.locator('app-calendar-filters [data-impact="holiday"]');
  await expect(holiday).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('app-calendar-filters [data-impact="low"]')).toHaveAttribute('aria-pressed', 'false');

  await holiday.click();
  await expect(holiday).toHaveAttribute('aria-pressed', 'false');

  await page.reload();

  // The active view (`ViewStore`) also persists, so the calendar view is
  // already showing again without pressing `c`.
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('app-calendar-filters [data-impact="holiday"]')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('[data-testid="calendar-reset"]').click();
  await expect(page.locator('app-calendar-filters [data-impact="holiday"]')).toHaveAttribute('aria-pressed', 'true');
});

test('sound alerts: the toggle arms audio; after a reload the bell shows unarmed until the first click', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('c');
  const toggle = page.locator('[data-testid="sound-alerts"]');
  await toggle.check();
  await expect(page.locator('[data-testid="sound-unarmed"]')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="sound-alerts"]')).toBeChecked();
  await expect(page.locator('[data-testid="sound-unarmed"]')).toBeVisible();

  await page.locator('[data-testid="calendar-week"] .week-range').click();
  await expect(page.locator('[data-testid="sound-unarmed"]')).toHaveCount(0);
});
