import type { Page } from '@playwright/test';
import type { Session } from '@trade-automation/contracts';
import { apiUrl, expect, replayStarted, test } from './fixtures';

/**
 * T-022 done-line (backtest-app-system-design.md §9.1) against the mock's replay tape: two drafts
 * on one panel, dragged by their handles and lines without the chart panning, activated by click,
 * removed with Esc; Enter with no active draft only shows the hint. The tools are drawn on a
 * canvas, so the test reads the panel body's `data-position-tools` / `data-pointer-price` hooks and
 * finds a handle through the controller's `data-position-tool-hover`. Set POSITION_TOOL_SHOTS to a
 * directory to save screenshots.
 */
const FRIDAY_2140 = Date.UTC(2024, 2, 1, 21, 40);
const SHOTS = process.env['POSITION_TOOL_SHOTS'];
/** The controller's hit tolerance (position-tool.controller.ts `HIT_TOLERANCE_PX`). */
const HIT_TOLERANCE_PX = 6;

type Tool = { id: string; side: string; mode: string; entry: number; sl: number; tp: number; active: boolean };

async function tools(page: Page): Promise<Tool[]> {
  const raw = (await page.locator('.chart-panel[data-panel-id="btc"] .panel-body').getAttribute('data-position-tools')) ?? '';
  return raw.split(' ').filter(Boolean).map((s) => {
    const [id, side, mode, entry, sl, tp, active] = s.split(':');
    return { id, side, mode, entry: Number(entry), sl: Number(sl), tp: Number(tp), active: active === 'active' };
  });
}

test('position tool: two drafts, handle drags without panning, click to activate, Esc removes, Enter hints', async ({ page }) => {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e position tool ${Date.now()}`,
      layout: { id: 'pt-e2e', name: 'PT e2e', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
      timeframe: '5m',
      periodFromMs: FRIDAY_2140,
      periodToMs: FRIDAY_2140 + 3 * 86_400_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    },
  });
  const session = (await created.json()) as Session;
  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page); // not `replay-loading` count 0: that also holds before the toolbar exists
  const body = page.locator('.chart-panel[data-panel-id="btc"] .panel-body');
  const container = body.locator('.chart-container');
  const box = (await container.boundingBox())!;

  // the pointer's price at two heights → the price ↔ y mapping of this chart
  const priceAt = async (y: number) => {
    await page.mouse.move(box.x + box.width * 0.4, y);
    await expect(body).toHaveAttribute('data-pointer-price', /\d/);
    return Number(await body.getAttribute('data-pointer-price'));
  };
  const y1 = box.y + box.height * 0.25;
  const y2 = box.y + box.height * 0.65;
  const p1 = await priceAt(y1);
  const p2 = await priceAt(y2);
  const yOf = (price: number) => y1 + ((price - p1) * (y2 - y1)) / (p2 - p1);

  // two drafts with the pointer off the chart: both at the last close (market)
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.keyboard.press('b');
  await page.keyboard.press('s');
  await expect.poll(async () => (await tools(page)).map((t) => [t.side, t.mode, t.active])).toEqual([
    ['long', 'market', false],
    ['short', 'market', true],
  ]);
  const [long0, short0] = await tools(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-two-drafts.png` });

  const visibleFrom = await container.getAttribute('data-visible-from');

  // drag the short (drawn on top) by its entry line up, above the last close, where it becomes a
  // limit. BUG-010: the target is 20 px above the long's target line, not a fixed distance — a fixed
  // 40 px once landed the short's entry within 2 px of the long's TP, and the click further down then
  // (correctly) hit whichever line was nearer.
  const lineX = box.x + box.width - 120;
  const dragTo = yOf(long0.tp) - 20;
  await page.mouse.move(lineX, yOf(short0.entry));
  await expect(container).toHaveAttribute('data-position-tool-hover', `line:body:${short0.id}`);
  await page.mouse.down();
  await page.mouse.move(lineX, (yOf(short0.entry) + dragTo) / 2, { steps: 4 });
  await page.mouse.move(lineX, dragTo, { steps: 4 });
  await page.mouse.up();
  const short1 = (await tools(page)).find((t) => t.id === short0.id)!;
  expect(short1.mode).toBe('limit');
  expect(short1.entry).toBeGreaterThan(short0.entry);
  expect(short1.sl - short1.entry).toBeCloseTo(short0.sl - short0.entry, 1); // the whole tool moved
  // the short's entry line is clear of every other line by two hit tolerances, so the click below is unambiguous
  const others = [long0.entry, long0.sl, long0.tp, short1.sl, short1.tp].map((p) => Math.abs(yOf(p) - yOf(short1.entry)));
  expect(Math.min(...others)).toBeGreaterThan(2 * HIT_TOLERANCE_PX);

  // find the long's stop handle (scan along its level) and drag it 30 px down
  const slY = yOf(long0.sl);
  let handleX: number | null = null;
  for (let x = box.x + 2; x < box.x + box.width - 60 && handleX === null; x += 3) {
    await page.mouse.move(x, slY);
    if ((await container.getAttribute('data-position-tool-hover')) === `handle:sl:${long0.id}`) handleX = x;
  }
  expect(handleX, 'the long draft has an SL handle').not.toBeNull();
  await page.mouse.down();
  await page.mouse.move(handleX!, slY + 15, { steps: 3 });
  await page.mouse.move(handleX!, slY + 30, { steps: 3 });
  await page.mouse.up();
  const long1 = (await tools(page)).find((t) => t.id === long0.id)!;
  expect(long1.sl).toBeLessThan(long0.sl);
  expect(long1.active).toBe(true); // grabbing it made it the active tool
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-after-drags.png` });

  // neither drag panned the chart…
  await expect(container).toHaveAttribute('data-visible-from', visibleFrom!);

  // click the short's entry line to activate it, then Esc removes it
  await page.mouse.move(lineX, yOf(short1.entry));
  await expect(container).toHaveAttribute('data-position-tool-hover', `line:body:${short0.id}`); // the pointer is on the short, not a neighbour
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await tools(page)).find((t) => t.active)?.id).toBe(short0.id);
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await tools(page)).map((t) => t.id)).toEqual([long0.id]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-after-esc.png` });

  // nothing is active now: Enter only shows the hint
  await page.keyboard.press('Enter');
  await expect(page.locator('.hint[role="status"]')).toHaveText('No active position tool — press B or S');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-enter-hint.png` });
  expect((await tools(page)).map((t) => t.id)).toEqual([long0.id]);

  // …and after all the tool drags, a drag on empty chart area still pans (scroll/scale were restored).
  // Last, because panning rescales the price axis and would stale the price ↔ y mapping above.
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.1, { steps: 5 });
  await page.mouse.up();
  await expect(container).not.toHaveAttribute('data-visible-from', visibleFrom!);
});

test('T-045: the order popup appears only at Enter; Esc, Cancel and a click outside close it and keep the draft', async ({ page }) => {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e order popup ${Date.now()}`,
      layout: { id: 'op-e2e', name: 'OP e2e', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
      timeframe: '5m',
      periodFromMs: FRIDAY_2140,
      periodToMs: FRIDAY_2140 + 3 * 86_400_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    },
  });
  const session = (await created.json()) as Session;
  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);
  const popup = page.getByTestId('order-popup');

  await page.keyboard.press('b');
  await expect.poll(async () => (await tools(page)).length).toBe(1);
  await expect(popup).toHaveCount(0); // drawing a draft never opens it

  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('order-qty')).toHaveText(/\d/);
  await page.keyboard.press('ArrowRight'); // modal: no step while it is open
  await expect(page.getByTestId('replay-cursor')).toHaveText('2024-03-01 21:40 UTC');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);

  await page.keyboard.press('Enter');
  await popup.getByTestId('order-cancel').click();
  await expect(popup).toHaveCount(0);

  await page.keyboard.press('Enter');
  await page.getByTestId('order-popup-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(popup).toHaveCount(0);
  expect((await tools(page)).length).toBe(1); // the draft is still there, after all three
});

test('T-048: by clicks only — Buy / Sell draw tools, Place opens the order popup, Cancel keeps the draft', async ({ page }) => {
  const created = await page.context().request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e trade controls ${Date.now()}`,
      layout: { id: 'tc-e2e', name: 'TC e2e', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
      timeframe: '5m',
      periodFromMs: FRIDAY_2140,
      periodToMs: FRIDAY_2140 + 3 * 86_400_000,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    },
  });
  const session = (await created.json()) as Session;
  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);

  await expect(page.getByTestId('trade-buy')).toHaveAttribute('title', /hotkey B/);
  await expect(page.getByTestId('trade-sell')).toHaveAttribute('title', /hotkey S/);
  await expect(page.getByTestId('trade-place')).toHaveAttribute('title', /hotkey Enter/);

  await page.getByTestId('trade-buy').click();
  await page.getByTestId('trade-sell').click();
  await expect.poll(async () => (await tools(page)).map((t) => [t.side, t.mode, t.active])).toEqual([
    ['long', 'market', false],
    ['short', 'market', true],
  ]);

  if (process.env['T048_SHOTS']) {
    await page.getByTestId('trade-sell').hover();
    await page.screenshot({ path: `${process.env['T048_SHOTS']}/toolbar-trade-controls.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 } });
  }
  await page.getByTestId('trade-place').click();
  const popup = page.getByTestId('order-popup');
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('order-panel')).toContainText('short market');
  await popup.getByTestId('order-cancel').click();
  await expect(popup).toHaveCount(0);
  expect((await tools(page)).length).toBe(2);
});
