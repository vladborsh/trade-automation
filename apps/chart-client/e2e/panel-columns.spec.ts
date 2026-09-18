import { test, expect, type Page } from '@playwright/test';

/**
 * architecture/chart-layouts.md §11.3 — horizontal columns and collapsible panels, against the
 * mock server. The collapse/restore sequence below is the design's mandatory acceptance for the
 * three sync rules; rule 2 (a restored chart JOINS the current shared range, never leads with
 * its own autofit window) is the one most likely to break.
 */

// Default mock instance, like terminal.spec.ts's routed tests. `E2E_MOCK_PORT` lets a worktree
// that cannot use :4300 point this spec at its own mock server.
const MOCK_PORT = process.env['E2E_MOCK_PORT'] ?? '4300';
const EPSILON_SEC = 5 * 60; // half a 5m bar, generously rounded — same as terminal.spec.ts
const PANEL_IDS = ['btc', 'eth', 'btc-oi', 'dxy'];

interface Range {
  from: number;
  to: number;
}

async function routeConfigToMock(page: Page): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ apiBaseUrl: `http://localhost:${MOCK_PORT}/api`, wsUrl: `ws://localhost:${MOCK_PORT}/ws` }),
    }),
  );
}

function chartOf(page: Page, panelId: string) {
  return page.locator(`.chart-panel[data-panel-id="${panelId}"] .chart-container`);
}

async function rangeOf(page: Page, panelId: string): Promise<Range> {
  const container = chartOf(page, panelId);
  return {
    from: Number(await container.getAttribute('data-visible-from')),
    to: Number(await container.getAttribute('data-visible-to')),
  };
}

function expectSameRange(actual: Range, expected: Range, label: string): void {
  expect(Math.abs(actual.from - expected.from), `${label} from`).toBeLessThanOrEqual(EPSILON_SEC);
  expect(Math.abs(actual.to - expected.to), `${label} to`).toBeLessThanOrEqual(EPSILON_SEC);
}

/** Pans `panelId`'s plot body left-to-right (towards older bars), `times` drags of ~70 % width. */
async function scrollBack(page: Page, panelId: string, times: number): Promise<void> {
  const box = await chartOf(page, panelId).boundingBox();
  if (!box) {
    throw new Error(`${panelId} chart has no bounding box`);
  }
  for (let i = 0; i < times; i++) {
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5, { steps: 15 });
    await page.mouse.up();
  }
  await page.mouse.move(0, 0); // leave the pane: no crosshair left behind
}

/** Waits until every listed panel shows the same range (within epsilon), and returns panel 1's. */
async function convergedRange(page: Page, panelIds: string[]): Promise<Range> {
  let shared: Range = { from: 0, to: 0 };
  await expect(async () => {
    const ranges = await Promise.all(panelIds.map((id) => rangeOf(page, id)));
    for (const [i, r] of ranges.entries()) {
      expectSameRange(r, ranges[0], panelIds[i]);
    }
    shared = ranges[0];
  }).toPass({ timeout: 15_000 });
  return shared;
}

async function bootCrypto(page: Page): Promise<string[]> {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'warning' && msg.text().includes('[ChartSyncService]')) {
      warnings.push(msg.text());
    }
  });
  await routeConfigToMock(page);
  await page.goto('/');
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });
  for (const id of PANEL_IDS) {
    await expect(chartOf(page, id)).toHaveAttribute('data-visible-to', /\d+/, { timeout: 15_000 });
  }
  return warnings;
}

test('every layout renders as one row of columns, left to right in panel order', async ({ page }) => {
  await bootCrypto(page);
  const boxes = await Promise.all(PANEL_IDS.map((id) => page.locator(`.chart-panel[data-panel-id="${id}"]`).boundingBox()));
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(boxes[i]!.y - boxes[0]!.y)).toBeLessThanOrEqual(1); // same row
    expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width - 1); // to the right
    expect(Math.abs(boxes[i]!.width - boxes[0]!.width)).toBeLessThanOrEqual(2); // equal share
  }
});

test('collapse/restore keeps the shared range: no breaker, restored panel joins the CURRENT range, state persists', async ({
  page,
}) => {
  const warnings = await bootCrypto(page);

  // 1. Scroll panel 1 back about a day (5m bars; each drag pans ~3 h at the default width).
  const initial = await rangeOf(page, 'btc');
  await scrollBack(page, 'btc', 8);
  const beforeCollapse = await convergedRange(page, PANEL_IDS);
  expect(initial.to - beforeCollapse.to).toBeGreaterThan(18 * 3600);

  // 2. Collapse panel 2: its chart is destroyed (a strip remains), the others re-flow wider.
  const eth = page.locator('.chart-panel[data-panel-id="eth"]');
  const btcWidthBefore = (await chartOf(page, 'btc').boundingBox())!.width;
  await eth.getByRole('button', { name: 'Collapse panel' }).click();
  await expect(eth).toHaveCount(0);
  const strip = page.locator('.collapsed-panel-strip[data-panel-id="eth"]');
  await expect(strip).toBeVisible();
  expect((await strip.boundingBox())!.width).toBeLessThanOrEqual(28);
  await expect.poll(async () => (await chartOf(page, 'btc').boundingBox())!.width).toBeGreaterThan(btcWidthBefore);

  // 3. Panels 1/3/4 agree with each other AND with the pre-collapse range; no breaker trip.
  await page.waitForTimeout(500); // let every resize settle and any echo arrive
  const afterCollapse = await convergedRange(page, ['btc', 'btc-oi', 'dxy']);
  expectSameRange(afterCollapse, beforeCollapse, 'after collapse vs before');
  expect(warnings).toEqual([]);

  // 4. Scroll panel 1 further back while panel 2 is collapsed.
  await scrollBack(page, 'btc', 2);
  const current = await convergedRange(page, ['btc', 'btc-oi', 'dxy']);
  expect(beforeCollapse.to - current.to).toBeGreaterThan(4 * 3600);

  // 5. Restore panel 2: it shows the CURRENT shared range — not its autofit latest window, not
  //    the range at collapse time — and nobody else moved.
  await strip.click();
  await expect(eth).toHaveCount(1);
  await expect(chartOf(page, 'eth')).toHaveAttribute('data-visible-to', /\d+/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const afterRestore = await convergedRange(page, PANEL_IDS);
  expectSameRange(afterRestore, current, 'after restore vs current');
  expectSameRange(await rangeOf(page, 'eth'), current, 'eth after restore');
  expect(warnings).toEqual([]);

  // 6. Reload: the state persists as left (all expanded) …
  await page.reload();
  await expect(page.locator('app-chart-panel')).toHaveCount(4, { timeout: 15_000 });
  await expect(page.locator('.collapsed-panel-strip')).toHaveCount(0);

  // … and a collapse survives a reload.
  await page.locator('.chart-panel[data-panel-id="eth"]').getByRole('button', { name: 'Collapse panel' }).click();
  await expect(page.locator('.collapsed-panel-strip[data-panel-id="eth"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('.collapsed-panel-strip[data-panel-id="eth"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('app-chart-panel')).toHaveCount(3);
  expect(warnings).toEqual([]);
});

test('the last expanded panel cannot be collapsed', async ({ page }) => {
  await bootCrypto(page);
  for (const id of ['btc', 'eth', 'btc-oi']) {
    await page.locator(`.chart-panel[data-panel-id="${id}"]`).getByRole('button', { name: 'Collapse panel' }).click();
  }
  const last = page.locator('.chart-panel[data-panel-id="dxy"]').getByRole('button', { name: 'Collapse panel' });
  await expect(last).toBeDisabled();
  await expect(last).toHaveAttribute('title', 'At least one panel stays open');
  await expect(page.locator('.collapsed-panel-strip')).toHaveCount(3);
});

test('a metric series swap on timeframe change (§11.2) joins the grid: panels converge, no breaker', async ({ page }) => {
  const warnings = await bootCrypto(page);

  // 5m → 1m: the OI panel swaps candles → line; 1m → 15m: line → candles.
  for (const [tf, style] of [
    ['1m', 'line'],
    ['15m', 'candles'],
  ] as const) {
    await scrollBack(page, 'btc', 2);
    await page.getByRole('button', { name: tf, exact: true }).click();
    await expect(page.locator('.chart-panel[data-panel-id="btc-oi"] .panel-body')).toHaveAttribute('data-metric-style', style);
    for (const id of PANEL_IDS) {
      await expect(chartOf(page, id)).toHaveAttribute('data-visible-to', /\d+/, { timeout: 15_000 });
    }
    await page.waitForTimeout(500);
    await convergedRange(page, PANEL_IDS);
    expect(warnings).toEqual([]);
  }
});
