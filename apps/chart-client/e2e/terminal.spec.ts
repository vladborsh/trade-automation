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

/**
 * architecture/vwap-band-reversal-plugin.md §8.2 step 5: on US100/1m the
 * three synthetic VWAP band lines render, an amber/research-styled marker
 * renders, and the research badge is visible; switching to 5m hides the
 * band lines (§3.1's timeframe rule) while the badge stays visible.
 */
test('shows the research-tier VWAP band + badge on US100/1m, hides the band on 5m', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('/');
  await page.locator('.switcher-input').fill('US100');
  await page.locator('.switcher-list button', { hasText: 'capitalcom:US100' }).click();
  await expect(page.locator('.status-bar .instrument')).toHaveText('capitalcom:US100');

  // 1m is not the default (`timeframe.store.ts` defaults to 5m), so switch explicitly.
  await page.getByRole('button', { name: '1m', exact: true }).click();

  const chartContainer = page.locator('.chart-container');
  await expect(chartContainer).toHaveAttribute('data-marker-count', /[1-9]\d*/, { timeout: 15_000 });

  // Research badge — first line always visible, fixed copy.
  const badge = page.locator('app-research-badge .research-badge');
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await expect(badge).toContainText('RESEARCH — not a trading signal');

  // Status bar lists the research-tier strategy explicitly.
  await expect(page.locator('.status-bar .strategies')).toContainText('vwap-band-reversal (research)');

  // Three VWAP band lines (vwap/vwapTop/vwapBottom) — `data-indicator-series-count`
  // is a test hook (chart.component.ts) since lightweight-charts draws to
  // canvas and exposes no other DOM surface to assert on.
  await expect(chartContainer).toHaveAttribute('data-indicator-series-count', '3', { timeout: 15_000 });

  // Switch to 5m: the band's own timeframe ('1m') no longer matches the
  // chart's displayed timeframe, so the layer hides it (§3.1) — the badge
  // must still be visible, since the strategy itself is still active.
  await page.getByRole('button', { name: '5m', exact: true }).click();
  await expect(page.locator('.status-bar .instrument')).toHaveText('capitalcom:US100');
  await expect(chartContainer).toHaveAttribute('data-indicator-series-count', '0');
  await expect(badge).toBeVisible();
});
