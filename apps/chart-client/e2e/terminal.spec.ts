import { test, expect } from '@playwright/test';

/**
 * §9.1's end-to-end proof: boots the mock server + client, switches
 * instrument, and confirms the demo `example-cross` signal renders as a
 * marker via the OverlayLayer.
 */
test('boots, switches instrument, and renders a signal marker on the chart', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.switcher-input')).toBeVisible();

  // Wait for the initial instrument (boot restores the last selection, or
  // the first configured one) to have candles and a rendered marker.
  const chartContainer = page.locator('.chart-container');
  await expect(chartContainer).toHaveAttribute('data-marker-count', /[1-9]\d*/, { timeout: 15_000 });

  // Switch instrument via the `/` shortcut + search, per §5.1's keyboard shortcuts.
  await page.keyboard.press('/');
  await page.locator('.switcher-input').fill('ETHUSDT');
  await page.locator('.switcher-list button', { hasText: 'binance:ETHUSDT' }).click();

  await expect(page.locator('.status-bar .instrument')).toHaveText('binance:ETHUSDT');
  await expect(chartContainer).toHaveAttribute('data-marker-count', /[1-9]\d*/, { timeout: 15_000 });

  // Live connection should be up (mock server ws) once boot settles.
  await expect(page.locator('.status-bar .conn')).toHaveText('live', { timeout: 15_000 });
});
