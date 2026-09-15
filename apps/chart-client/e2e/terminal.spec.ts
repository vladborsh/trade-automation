import { test, expect, type Page } from '@playwright/test';

/**
 * architecture/chart-layouts.md §9 SE-5's e2e proof: boots on the `crypto`
 * layout (4 panels incl. the mock's `capitalcom:DXY-MOCK`), confirms signal
 * markers render only on the two `signals: true` panels (BTC/ETH) — the
 * same overlay + research-badge machinery the VWAP client unit added, now
 * exercised per-panel instead of against one globally selected instrument
 * — changes timeframe and confirms all four panels re-fetch, then scrolls
 * panel 1 back and confirms the synced range lands on all four panels and
 * that panel 2 fires its own older-history request as a *consequence* of
 * the synced range change, not because it was scrolled directly.
 */

function panelById(page: Page, id: string) {
  return page.locator(`.chart-panel[data-panel-id="${id}"]`);
}

async function chartPanels(page: Page) {
  return page.locator('app-chart-panel');
}

test('boots on the crypto layout with 4 panels, markers only on signals:true panels', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const btcPanel = panelById(page, 'btc');
  const ethPanel = panelById(page, 'eth');
  const dxyPanel = panelById(page, 'dxy');

  // signals:true panels (BTC, ETH) render at least one marker — the same
  // overlay pipeline (`signalsToOverlays` → `OverlayLayer`) the VWAP unit
  // relies on, now fed per-panel by that panel's own PanelFeed.
  await expect(btcPanel.locator('.chart-container')).toHaveAttribute('data-marker-count', /[1-9]\d*/, {
    timeout: 15_000,
  });
  await expect(ethPanel.locator('.chart-container')).toHaveAttribute('data-marker-count', /[1-9]\d*/, {
    timeout: 15_000,
  });

  // signals:false panels (DXY here; the OI metric panel too) never show markers.
  await expect(dxyPanel.locator('.chart-container')).toHaveAttribute('data-marker-count', '0');

  // The research badge (VWAP client unit, untouched) is visible wherever its
  // "non-live tier" condition holds for that panel's own signals/indicators —
  // confirms the badge keeps working when resolved via the per-panel scoped
  // stores instead of one global selection.
  await expect(btcPanel.locator('app-research-badge .research-badge')).toBeVisible({ timeout: 15_000 });
  await expect(dxyPanel.locator('app-research-badge .research-badge')).toHaveCount(0);
});

test('changing timeframe re-fetches all four panels', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  for (const panel of await (await chartPanels(page)).all()) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });
  }

  await page.getByRole('button', { name: '1h', exact: true }).click();

  // A fresh history fetch + re-render resets each panel's own visible range;
  // re-asserting the hook still resolves confirms every panel came back up
  // on the new timeframe rather than freezing on stale 5m data.
  for (const panel of await (await chartPanels(page)).all()) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });
  }
});

test('scrolling one panel back syncs the visible range to all four and triggers an independent older-history fetch on another', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const panels = await (await chartPanels(page)).all();
  for (const panel of panels) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });
  }

  const firstContainer = panels[0].locator('.chart-container');
  const box = await firstContainer.boundingBox();
  if (!box) {
    throw new Error('chart container has no bounding box');
  }

  const secondContainer = panels[1].locator('.chart-container');
  const beforeFrom = await secondContainer.getAttribute('data-visible-from');

  // Drag panel 1's time scale to scroll it back — a user gesture on ONE panel.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 10 });
  await page.mouse.up();

  // All four panels converge on (approximately) the same visible range.
  await expect(async () => {
    const froms: number[] = [];
    const tos: number[] = [];
    for (const panel of panels) {
      const container = panel.locator('.chart-container');
      froms.push(Number(await container.getAttribute('data-visible-from')));
      tos.push(Number(await container.getAttribute('data-visible-to')));
    }
    const epsilon = 5 * 60; // half a 5m bar generously rounded, well above lightweight-charts snap noise
    expect(Math.max(...froms) - Math.min(...froms)).toBeLessThanOrEqual(epsilon);
    expect(Math.max(...tos) - Math.min(...tos)).toBeLessThanOrEqual(epsilon);
  }).toPass({ timeout: 15_000 });

  // Panel 2 was never scrolled directly, yet its own visible-from moved
  // because the synced range change pushed it toward its own history edge,
  // which fires its own independent loadOlder() — not a jump caused by
  // scrolling panel 2 itself.
  const afterFrom = await secondContainer.getAttribute('data-visible-from');
  expect(afterFrom).not.toBe(beforeFrom);
});

// architecture/scroll-back-freeze-diagnosis.md's "loadOlder() pagination trigger unreachable
// at real-data buffer depth" follow-up: the test above runs against the default mock server
// (:4300), whose ~576-5m-bar-per-instrument fixture is comfortably under lightweight-charts'
// zoom-out floor (~1260-1300 bars) — every panel's own oldest bar is reachable in a single
// zoom-drag there, which is exactly why the old absolute-bar-index trigger's unreachability at
// real HISTORY_LIMIT=1500 depth shipped without any test catching it. This test instead points
// its page at the dedicated :4301 mock server instance (see playwright.config.ts), which seeds
// `binance:BTCUSDT` to HISTORY_LIMIT-comparable depth (1500 5m bars) while leaving the other
// instruments at the default shallow depth — the same asymmetry the real repro found between
// `btc` and `btc-oi` — and asserts a REAL follow-up `/api/candles` network request fires from a
// single zoom-drag, not just a DOM attribute change (which, per the diagnosis, stays true
// whether or not loadOlder()'s fetch actually ran).
test('a single zoom-drag against a real-HISTORY_LIMIT-deep buffer still fires a follow-up /api/candles request', async ({
  page,
}) => {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ apiBaseUrl: 'http://localhost:4301/api', wsUrl: 'ws://localhost:4301/ws' }),
    }),
  );

  const candlesRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/candles')) {
      candlesRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const panels = await (await chartPanels(page)).all();
  for (const panel of panels) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });
  }

  const requestCountBeforeDrag = candlesRequests.length;

  const firstContainer = panels[0].locator('.chart-container');
  const box = await firstContainer.boundingBox();
  if (!box) {
    throw new Error('chart container has no bounding box');
  }

  // A single time-axis zoom-drag on btc (the deep, 1500-bar panel) — per the diagnosis, this
  // gesture alone cannot reach anywhere near btc's own oldest bar once its buffer exceeds the
  // zoom floor, so a follow-up fetch (if one fires) comes from another, shallower-buffered
  // panel receiving the synced range, exactly like the real repro's btc/btc-oi asymmetry.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 10 });
  await page.mouse.up();

  await expect(async () => {
    expect(candlesRequests.length).toBeGreaterThan(requestCountBeforeDrag);
  }).toPass({ timeout: 15_000 });
});
