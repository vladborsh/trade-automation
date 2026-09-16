import { test, expect } from '@playwright/test';

/**
 * architecture/economic-calendar.md §10 SE-CAL-2's e2e proof: boots on the
 * charts view, receives a synthetic `notification` frame from the mock
 * server → a toast becomes visible → clicking it switches to the calendar
 * view with the corresponding row highlighted; the `c` shortcut toggles
 * views; calendar filters persist across a page reload.
 */

test('boots on the charts view, shows a toast from the mock notification frame, and clicking it opens the calendar view with the row highlighted', async ({
  page,
}) => {
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

  const impactSelect = page.locator('app-calendar-filters select');
  await impactSelect.selectOption('high');
  await expect(impactSelect).toHaveValue('high');

  await page.reload();

  // The active view (`ViewStore`) also persists, so the calendar view is
  // already showing again without pressing `c`.
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('app-calendar-filters select')).toHaveValue('high');
});
