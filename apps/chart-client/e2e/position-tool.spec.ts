import type { Page } from '@playwright/test';
import type { Session } from '@trade-automation/contracts';
import { apiUrl, expect, test } from './fixtures';

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
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
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

  // drag the short (drawn on top) by its entry line, 40 px up: above the last close it becomes a limit
  const lineX = box.x + box.width - 120;
  await page.mouse.move(lineX, yOf(short0.entry));
  await expect(container).toHaveAttribute('data-position-tool-hover', `line:body:${short0.id}`);
  await page.mouse.down();
  await page.mouse.move(lineX, yOf(short0.entry) - 20, { steps: 4 });
  await page.mouse.move(lineX, yOf(short0.entry) - 40, { steps: 4 });
  await page.mouse.up();
  const short1 = (await tools(page)).find((t) => t.id === short0.id)!;
  expect(short1.mode).toBe('limit');
  expect(short1.entry).toBeGreaterThan(short0.entry);
  expect(short1.sl - short1.entry).toBeCloseTo(short0.sl - short0.entry, 1); // the whole tool moved

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
