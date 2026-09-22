import type { Locator, Page } from '@playwright/test';
import type { Candle } from '@trade-automation/contracts';
import { DEEP_HISTORY_MOCK_PORT, FROZEN_MOCK_PORT, TAIL_GAP_MOCK_PORT, apiUrl, expect, plotBox, routeConfigTo, test } from './fixtures';

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

/**
 * BUG-007: waits until every panel has its history and shows the one shared window (all visible
 * ranges within half a 5m bar) — the grid's boot seeding has finished. Every panel seeds on its
 * own first data, so once all agree nothing but a gesture moves them. A baseline read before
 * this can catch a panel still on its own autofit window.
 */
async function waitForSyncedGrid(panels: Locator[]): Promise<void> {
  await expect(async () => {
    const froms: number[] = [];
    const tos: number[] = [];
    for (const panel of panels) {
      const container = panel.locator('.chart-container');
      froms.push(Number(await container.getAttribute('data-visible-from')));
      tos.push(Number(await container.getAttribute('data-visible-to')));
    }
    const halfBar = 150;
    expect(Math.max(...froms) - Math.min(...froms)).toBeLessThanOrEqual(halfBar);
    expect(Math.max(...tos) - Math.min(...tos)).toBeLessThanOrEqual(halfBar);
  }).toPass({ timeout: 15_000 });
}

test('boots on the crypto layout with 4 panels, markers only on signals:true panels', async ({ page }) => {
  await page.goto('/terminal');

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
  await page.goto('/terminal');
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
  await page.goto('/terminal');
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
  // Geometry-calibrated: a single zoom-drag's reach is bounded by lightweight-charts'
  // zoom-out floor (~panelWidthPx / 0.5 bars). Since chart-layouts.md §11.3 the four panels are
  // one row of columns (~315 px each at the default 1280 px viewport) instead of a 2x2 grid
  // (~640 px), which halves that reach below the shallow panels' 2-day depth. A 2560 px viewport
  // restores the per-panel width this scenario was written against.
  await page.setViewportSize({ width: 2560, height: 720 });
  await routeConfigTo(page, DEEP_HISTORY_MOCK_PORT);

  const candlesRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/candles')) {
      candlesRequests.push(request.url());
    }
  });

  await page.goto('/terminal');
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

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 3: lightweight-charts' visible TIME
// range clamps `to` to the last loaded bar, so a pan past the right edge is unrepresentable on
// the old time-range sync channel — the driver's window collapses to a couple of bars and every
// follower stretches those same couple of bars across its full width (the live repro,
// architecture/scratch/repro-right-edge-desync.mjs, caught this: btc went from 103 bars to 2,
// eth/btc-oi/dxy zoomed in ~50x on the same 2 bars). This is the assertion gap that let it ship:
// the old test only checked `data-visible-from` CHANGED, which stayed true even for a collapsed
// window. This test instead asserts the window WIDTH survives the pan.
test('panning past the right edge moves all four panels into the void together, preserving window width', async ({ page }) => {
  // Explicit route to the frozen-feed mock instance (:4303, the default data with no live bars —
  // BUG-007), independent of whatever the shared dev server's public/config.json points at.
  await routeConfigTo(page, FROZEN_MOCK_PORT);

  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('[ChartSyncService]')) {
      warnings.push(msg.text());
    }
  });

  await page.goto('/terminal');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const panels = await (await chartPanels(page)).all();
  for (const panel of panels) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-to', /\d+/, { timeout: 15_000 });
  }
  await waitForSyncedGrid(panels);

  const readWidthsAndTos = async () => {
    const widths: number[] = [];
    const tos: number[] = [];
    for (const panel of panels) {
      const container = panel.locator('.chart-container');
      const from = Number(await container.getAttribute('data-visible-from'));
      const to = Number(await container.getAttribute('data-visible-to'));
      widths.push(to - from);
      tos.push(to);
    }
    return { widths, tos };
  };

  const before = await readWidthsAndTos();
  const btcWidth = before.widths[0];
  const btcToBefore = before.tos[0];

  const box = await plotBox(panels[0].locator('.chart-container'));

  // The exact repro gesture: pan the btc plot body right-to-left three times, mid-height,
  // 0.8 -> 0.3 of the plot's width, dragging the last bar away from the right edge into the
  // void.
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 15 });
    await page.mouse.up();
  }

  await expect(async () => {
    const after = await readWidthsAndTos();

    // (a) all four `data-visible-to` are equal within half a bar, AND later than before the
    // pan — the void is represented, not clamped back onto the last real bar.
    const epsilon = 5 * 60; // half a 5m bar, generously rounded
    expect(Math.max(...after.tos) - Math.min(...after.tos)).toBeLessThanOrEqual(epsilon);
    expect(after.tos[0]).toBeGreaterThan(btcToBefore);

    // (b) all four widths are equal within a bar, AND equal to the pre-pan width — a pan is
    // not a zoom. Before this fix, btc's width collapsed from ~103 bars to ~2 while the
    // followers' widths stayed at the pre-pan value (they zoomed onto those 2 bars instead).
    const barSec = 5 * 60;
    expect(Math.max(...after.widths) - Math.min(...after.widths)).toBeLessThanOrEqual(barSec);
    for (const width of after.widths) {
      expect(Math.abs(width - btcWidth)).toBeLessThanOrEqual(barSec);
    }
  }).toPass({ timeout: 15_000 });

  // (c) no circuit-breaker warning: the guards converge on the new (void-inclusive) range,
  // they don't bounce.
  expect(warnings).toEqual([]);
});

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 3's "weekend case": dxy's mock history
// here ends 1 hour before the other instruments' (see playwright.config.ts's :4302 instance),
// the same shape as a real Capital.com weekend close. Before the fix, `setVisibleRange`'s
// `timeToIndex(findNearest=true)` snapped every later `to` onto dxy's own last bar, so dxy could
// never agree with btc's right-edge pan; the ruling is that dxy shows blank space instead.
test('a panel whose own history ends earlier still tracks a right-edge pan into the void (weekend case)', async ({ page }) => {
  await routeConfigTo(page, TAIL_GAP_MOCK_PORT);

  await page.goto('/terminal');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const panels = await (await chartPanels(page)).all();
  for (const panel of panels) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-to', /\d+/, { timeout: 15_000 });
  }
  await waitForSyncedGrid(panels);

  const btcContainer = panels[0].locator('.chart-container');
  const dxyContainer = panelById(page, 'dxy').locator('.chart-container');

  // BUG-007: the grid opens at the freshest data — btc's newest bar in view — whichever panel's
  // history arrived last. Before the fix the last arrival won, and dxy winning put every panel
  // at dxy's own last bar, in the past.
  const btcCandles: Candle[] = await (
    await page.context().request.get(`${apiUrl(TAIL_GAP_MOCK_PORT)}/candles?instrument=binance:BTCUSDT&timeframe=5m`)
  ).json();
  expect(Number(await btcContainer.getAttribute('data-visible-to'))).toBeGreaterThanOrEqual(btcCandles.at(-1)!.openTime / 1000);

  const box = await plotBox(btcContainer);

  // A single, moderate right-edge pan (not the aggressive 3x repro gesture above): the point of
  // this test is dxy's own tail gap, not the sync mechanism's absolute reach. `lightweight-
  // charts` itself caps how far the visible window can sit past the last loaded bar (roughly
  // one panel-width of bars, `TimeScale._private__maxRightOffset`) — a hard library limit,
  // independent of this fix, that a big enough excursion hits on EVERY panel including btc.
  // dxy's tail gap eats into that same budget before the pan even starts, so a pan aggressive
  // enough to also nearly exhaust btc's own budget would ask dxy to go further than the library
  // lets any panel go — not a sync bug. A moderate pan stays well inside that shared ceiling and
  // isolates the actual regression: pre-fix, dxy could never move past its OWN last bar at all.
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 15 });
  await page.mouse.up();

  await expect(async () => {
    const btcTo = Number(await btcContainer.getAttribute('data-visible-to'));
    const dxyTo = Number(await dxyContainer.getAttribute('data-visible-to'));
    const epsilon = 5 * 60;
    expect(Math.abs(btcTo - dxyTo)).toBeLessThanOrEqual(epsilon);
  }).toPass({ timeout: 15_000 });
});

// architecture/panel-sync-and-oi-depth-diagnosis.md bug 1: a never-built feature (chart-layouts
// §6.4 explicitly deferred it). The ruling is a TIME-synced crosshair — hovering panel 1 puts a
// vertical line on every panel at the same instant, each panel's own horizontal line at ITS OWN
// value there (never panel 1's price/value mirrored onto units it doesn't share).
test('hovering one panel syncs a time-matched crosshair to all four panels, without disturbing the visible range', async ({
  page,
}) => {
  // The frozen-feed instance (BUG-007): the "no echo" check below compares visible ranges, and a
  // live 5m close in between shifts every panel's window by a bar — correctly, but not an echo.
  await routeConfigTo(page, FROZEN_MOCK_PORT);

  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('[ChartSyncService]')) {
      warnings.push(msg.text());
    }
  });

  await page.goto('/terminal');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });

  const panels = await (await chartPanels(page)).all();
  for (const panel of panels) {
    await expect(panel.locator('.chart-container')).toHaveAttribute('data-visible-from', /\d+/, { timeout: 15_000 });
  }
  await waitForSyncedGrid(panels);

  const rangesBefore: { from: string | null; to: string | null }[] = [];
  for (const panel of panels) {
    const container = panel.locator('.chart-container');
    rangesBefore.push({
      from: await container.getAttribute('data-visible-from'),
      to: await container.getAttribute('data-visible-to'),
    });
  }

  const firstContainer = panels[0].locator('.chart-container');
  const box = await firstContainer.boundingBox();
  if (!box) {
    throw new Error('chart container has no bounding box');
  }

  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);

  await expect(async () => {
    const times: number[] = [];
    for (const panel of panels) {
      const t = await panel.locator('.chart-container').getAttribute('data-crosshair-time');
      expect(t).not.toBeNull();
      times.push(Number(t));
    }
    const barSec = 5 * 60;
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(barSec);
  }).toPass({ timeout: 15_000 });

  // Moving the pointer off the grid entirely clears the crosshair on every panel.
  await page.mouse.move(10, 10);
  await expect(async () => {
    for (const panel of panels) {
      const t = await panel.locator('.chart-container').getAttribute('data-crosshair-time');
      expect(t).toBeNull();
    }
  }).toPass({ timeout: 15_000 });

  // The concrete "no echo" check: hovering never disturbed the synced visible range on any
  // panel, and never tripped the range circuit breaker.
  for (let i = 0; i < panels.length; i++) {
    const container = panels[i].locator('.chart-container');
    expect(await container.getAttribute('data-visible-from')).toBe(rangesBefore[i].from);
    expect(await container.getAttribute('data-visible-to')).toBe(rangesBefore[i].to);
  }
  expect(warnings).toEqual([]);
});
