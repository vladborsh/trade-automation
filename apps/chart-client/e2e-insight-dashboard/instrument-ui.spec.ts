import { expect, test, type Page } from '@playwright/test';
import recorded from './fixtures/instrument-btcusdt.json';

/**
 * IB-099 — the owner's instrument-page fixes, in a real browser: the calendar badge opens the
 * tooltip, the legend switch survives a reload, full screen resizes the SAME chart and gives the
 * view back. The API is replayed from a recording of slot dev-3 (BTCUSDT, 2026-11-03, one USD
 * high-impact event in the 1m window: «Congressional Elections», 15:16 UTC) with the page clock
 * fixed to the recording's instant, so every window the page asks for is the one recorded.
 * (`/auth/me` is replaced by a plain member in English.)
 */
const responses = recorded.responses as Record<string, { status: number; body: unknown }>;

async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(recorded.fixedTimeMs);
  await page.route('**/api/web/**', (route) => {
    const u = new URL(route.request().url());
    const hit = responses[u.pathname.replace('/api/web', '') + u.search];
    return route.fulfill({ status: hit?.status ?? 404, contentType: 'application/json', body: JSON.stringify(hit?.body ?? { code: 'NOT_RECORDED', message: u.pathname }) });
  });
  await page.goto('/instrument/BTCUSDT');
  await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
}

test.describe('instrument page — desktop (IB-099)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('item 1: the flag badge is a ≥ 24 px target; a click pins the tooltip, a second click closes it; hover shows it', async ({ page }) => {
    await open(page);
    const badge = page.locator('.calendar-badge');
    await expect(badge).toBeVisible();
    const box = (await badge.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    await expect(badge.locator('svg')).toHaveCount(1); // an SVG flag, not an emoji
    await badge.click();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
    await page.mouse.move(10, 10); // pinned: leaving does not close it
    await expect(page.locator('.calendar-tooltip')).toBeVisible();
    await badge.click();
    await expect(page.locator('.calendar-tooltip')).toHaveCount(0);
    await badge.hover();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
  });

  test('item 2: one switch hides every legend, and the choice survives a reload', async ({ page }) => {
    await open(page);
    const legends = page.locator('.pane-legend');
    await expect(legends.first()).toBeVisible();
    await page.getByRole('button', { name: 'Hide legend' }).click();
    await expect(legends.filter({ visible: true })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
    await expect(legends.filter({ visible: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show legend' }).click();
    await page.reload();
    await expect(page.locator('.calendar-badge')).toHaveCount(1, { timeout: 30_000 });
    await expect(legends.first()).toBeVisible();
  });

  test('item 3: full screen grows the SAME chart and gives the view back; the button and Esc both leave', async ({ page }) => {
    await open(page);
    const canvas = page.locator('.chart-host canvas').first();
    await canvas.evaluate((el) => el.setAttribute('data-ib099', 'same'));
    const axisText = () => page.locator('.time-axis').innerText();
    const widthBefore = (await page.locator('.chart-host').boundingBox())!.width;
    const axisBefore = await axisText();
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeGreaterThan(widthBefore + 100);
    expect(await page.evaluate(() => !!document.fullscreenElement || !!document.querySelector('.fs-fallback'))).toBe(true);
    await page.getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeCloseTo(widthBefore, 0);
    await expect(page.locator('.chart-host canvas[data-ib099="same"]')).toHaveCount(1); // not re-created
    await expect.poll(axisText).toBe(axisBefore); // the same bars on screen: zoom and scroll kept
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeGreaterThan(widthBefore + 100);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await page.locator('.chart-host').boundingBox())!.width).toBeCloseTo(widthBefore, 0);
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  });
});

test.describe('instrument page — phone 390×844 (IB-099)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the badge is a ≥ 40 px target and a tap opens the tooltip; the page does not scroll sideways', async ({ page }) => {
    await open(page);
    const badge = page.locator('.calendar-badge');
    const box = (await badge.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(40);
    await badge.tap();
    await expect(page.locator('.calendar-tooltip')).toContainText('Congressional Elections');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const name of ['Hide legend', 'Full screen']) {
      const b = (await page.getByRole('button', { name }).boundingBox())!;
      expect(b.height, name).toBeGreaterThanOrEqual(40);
    }
  });
});
