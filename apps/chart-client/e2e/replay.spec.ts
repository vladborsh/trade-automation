import type { APIRequestContext } from '@playwright/test';
import type { Session, SessionDetail } from '@trade-automation/contracts';
import { apiUrl, expect, plotBox, replayStarted, test } from './fixtures';

/**
 * backtest-app-system-design.md §5.4 against the mock's deterministic tape (mock-server/
 * replay-tape.ts): open a session, step five times, switch the timeframe mid-bar — the cursor
 * stays and the newest bar is the partially formed one. Signed in as the mock admin.
 */

const FRIDAY_2140 = Date.UTC(2024, 2, 1, 21, 40); // 2024-03-01 was a Friday

async function createSession(request: APIRequestContext, periodToMs: number): Promise<Session> {
  const created = await request.post(`${apiUrl()}/backtest/sessions`, {
    data: {
      name: `e2e replay ${Date.now()}`,
      layout: {
        id: 'replay-e2e',
        name: 'Replay e2e',
        grid: { columns: 1, rows: 1 },
        panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
      },
      timeframe: '5m',
      periodFromMs: FRIDAY_2140,
      periodToMs,
      initialBalance: 10_000,
      defaultRiskPct: 1,
      costs: { enabled: false, commissionPct: 0, spread: 0 },
    },
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as Session;
}

/** Waits until the server has stored `cursorMs` — the AdvanceQueue has caught up (T-021). */
async function serverCursorReaches(request: APIRequestContext, id: string, cursorMs: number): Promise<void> {
  await expect
    .poll(async () => ((await (await request.get(`${apiUrl()}/backtest/sessions/${id}`)).json()) as SessionDetail).session.cursorMs)
    .toBe(cursorMs);
}

test('open a session, step five times, switch timeframe mid-bar', async ({ page }) => {
  const session = await createSession(page.context().request, FRIDAY_2140 + 3 * 86_400_000);

  await page.goto(`/sessions/${session.id}`);
  const cursor = page.getByTestId('replay-cursor');
  const body = page.locator('.chart-panel[data-panel-id="btc"] .panel-body');
  await expect(cursor).toHaveText('2024-03-01 21:40 UTC', { timeout: 15_000 });
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });

  for (const expected of ['21:45', '21:50', '21:55', '22:00', '22:05']) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`2024-03-01 ${expected} UTC`);
  }
  // On a 5m boundary the newest bar is the one that just closed.
  await expect(body).toHaveAttribute('data-last-open', String(Date.UTC(2024, 2, 1, 22, 0)));
  await expect(body).toHaveAttribute('data-last-closed', 'true');

  // Every step was persisted (T-021); once the server has 22:05, a switch anchors its history there.
  await serverCursorReaches(page.context().request, session.id, Date.UTC(2024, 2, 1, 22, 5));

  // ] → 15m: the cursor stays at 22:05, and the 22:00 bar is shown partially formed.
  const history = page.waitForResponse((r) => r.url().includes('/candles?') && r.url().includes('timeframe=15m'));
  await page.keyboard.press(']');
  // History up to the 15m boundary at or before the server's cursor; the rest of the forming bar is
  // folded from 1m on the client.
  expect(new URL((await history).url()).searchParams.get('before')).toBe(String(Date.UTC(2024, 2, 1, 22, 0)));
  await expect(page.locator('.tf-btn.active')).toHaveText('15m');
  await expect(cursor).toHaveText('2024-03-01 22:05 UTC');
  await expect(body).toHaveAttribute('data-last-open', String(Date.UTC(2024, 2, 1, 22, 0)));
  await expect(body).toHaveAttribute('data-last-closed', 'false');

  // …and it keeps forming as the cursor moves on inside it.
  await page.keyboard.press('ArrowRight');
  await expect(cursor).toHaveText('2024-03-01 22:15 UTC');
  await expect(body).toHaveAttribute('data-last-closed', 'true');
});

test('a reload resumes at the persisted cursor; stepping to the period end completes the session', async ({ page }) => {
  const request = page.context().request;
  const session = await createSession(request, Date.UTC(2024, 2, 1, 22, 10)); // six 5m steps long
  const cursor = page.getByTestId('replay-cursor');

  const loaded = () => expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 }); // → is inert while loading

  await page.goto(`/sessions/${session.id}`);
  await expect(cursor).toHaveText('2024-03-01 21:40 UTC', { timeout: 15_000 });
  await loaded();
  for (const expected of ['21:45', '21:50', '21:55']) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`2024-03-01 ${expected} UTC`);
  }
  await serverCursorReaches(request, session.id, Date.UTC(2024, 2, 1, 21, 55));

  await page.reload();
  await expect(cursor).toHaveText('2024-03-01 21:55 UTC', { timeout: 15_000 });
  await loaded();

  for (const expected of ['22:00', '22:05', '22:10']) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`2024-03-01 ${expected} UTC`);
  }
  await expect(page.getByTestId('replay-completed')).toHaveText('completed');
  await expect(page.getByTestId('replay-step')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(cursor).toHaveText('2024-03-01 22:10 UTC');

  await page.reload(); // complete on the server, so complete after a reload too
  await expect(page.getByTestId('replay-completed')).toHaveText('completed', { timeout: 15_000 });
});

// T-036: a step must not snap a panned chart back to the right edge. Every advance answer used to
// rebuild the panel sources (the store's `sources` read the whole session, which each answer
// updates), and a new source is a new chart — opened at the right edge.
test('after a pan into history, ten steps keep the visible range; pinned to the right edge, a step still follows the new bar', async ({ page }) => {
  const request = page.context().request;
  const session = await createSession(request, FRIDAY_2140 + 3 * 86_400_000);
  const cursor = page.getByTestId('replay-cursor');
  const chart = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');
  const range = async () => ({ from: await chart.getAttribute('data-visible-from'), to: await chart.getAttribute('data-visible-to') });
  /** The cursor after `n` 5m steps from 21:40, as the toolbar shows it. */
  const at = (n: number) => `${new Date(FRIDAY_2140 + n * 300_000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);
  await expect(chart).toHaveAttribute('data-visible-to', /\d+/);

  // pinned to the right edge (as opened): a step shifts the window by the new bar, as today
  const opened = await range();
  await page.keyboard.press('ArrowRight');
  await expect(cursor).toHaveText(at(1));
  await expect.poll(async () => Number((await range()).to)).toBeGreaterThan(Number(opened.to));
  await serverCursorReaches(request, session.id, Date.UTC(2024, 2, 1, 21, 45));

  // pan back into history, away from the right edge
  const box = await plotBox(chart);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => Number((await range()).to)).toBeLessThan(Number(opened.to));
  const panned = await range();

  for (let i = 2; i <= 11; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(at(i));
  }
  await serverCursorReaches(request, session.id, Date.UTC(2024, 2, 1, 22, 35)); // every answer has landed
  expect(await range()).toEqual(panned);
});

test('T-036: after a wheel zoom, ten steps keep the zoomed width', async ({ page }) => {
  const request = page.context().request;
  const session = await createSession(request, FRIDAY_2140 + 3 * 86_400_000);
  const cursor = page.getByTestId('replay-cursor');
  const chart = page.locator('.chart-panel[data-panel-id="btc"] .chart-container');
  const width = async () => Number(await chart.getAttribute('data-visible-to')) - Number(await chart.getAttribute('data-visible-from'));

  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);
  await expect(chart).toHaveAttribute('data-visible-to', /\d+/);
  const opened = await width();
  const box = await plotBox(chart);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -600); // zoom in
  await expect.poll(width).toBeLessThan(opened);
  const zoomed = await width();

  for (let i = 1; i <= 10; i++) {
    await page.keyboard.press('ArrowRight');
    await expect(cursor).toHaveText(`${new Date(FRIDAY_2140 + i * 300_000).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  }
  await serverCursorReaches(request, session.id, FRIDAY_2140 + 10 * 300_000);
  expect(await width()).toBe(zoomed);
});

test('T-046: the positions list is a toolbar dropdown; after clicking it the hotkeys still act', async ({ page }) => {
  const session = await createSession(page.context().request, FRIDAY_2140 + 3 * 86_400_000);
  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);
  const toggle = page.getByTestId('positions-toggle');
  const dropdown = page.getByTestId('positions-dropdown');

  await expect(toggle).toContainText('Positions');
  await expect(page.getByTestId('positions-count')).toHaveText('0'); // the mock holds no orders
  await expect(page.locator('app-positions-panel')).toHaveCount(0); // no always-visible list
  await expect(dropdown).toHaveCount(0);

  await toggle.click();
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toContainText('No pending or open orders.');
  await page.keyboard.press('ArrowRight'); // focus went back to the page: the step hotkey acts
  await expect(page.getByTestId('replay-cursor')).toHaveText('2024-03-01 21:45 UTC');

  await page.mouse.click(10, (page.viewportSize()?.height ?? 720) - 10); // a click outside (well clear of the list) closes it
  await expect(dropdown).toHaveCount(0);
  await toggle.click();
  await toggle.click(); // and so does a second click on the button
  await expect(dropdown).toHaveCount(0);
});

// T-052: Play at the default 0.5 s per candle for 3 s → about six steps; Pause stops it, and every
// step the client took is persisted (the queue coalesces the advances).
test('T-052: play 3 s at 0.5 s/candle steps about six times; pause stops it', async ({ page }) => {
  const request = page.context().request;
  const session = await createSession(request, FRIDAY_2140 + 3 * 86_400_000);
  const cursor = page.getByTestId('replay-cursor');
  const play = page.getByTestId('replay-play');
  const steps = async () => (Date.parse(`${(await cursor.innerText()).replace(' UTC', '')}Z`) - FRIDAY_2140) / 300_000;

  await page.goto(`/sessions/${session.id}`);
  await replayStarted(page);
  await expect(play).toHaveText('▶ Play');
  await play.click();
  await expect(play).toHaveText('❚❚ Pause');
  await page.waitForTimeout(3_000);
  await play.click();
  await expect(play).toHaveText('▶ Play');

  const taken = await steps();
  expect(taken).toBeGreaterThanOrEqual(5); // six at 0.5 s; one of slack either side for the browser's timers
  expect(taken).toBeLessThanOrEqual(7);
  await page.waitForTimeout(1_500);
  expect(await steps()).toBe(taken); // paused: nothing more
  await serverCursorReaches(request, session.id, FRIDAY_2140 + taken * 300_000);
});

// T-062: the toolbar at the three widths people use. Every item readable, the session name shown for
// at least ~20 characters (a 24-character name in full), nothing off-screen or overlapping; below a
// width the groups take a second row instead of squeezing the name.
test('T-062: at 1280, 1400 and 1920 px every toolbar item is readable and a 24-character name is shown in full', async ({ page }) => {
  const request = page.context().request;
  const session = await createSession(request, FRIDAY_2140 + 86_400_000);
  const NAME = 'London breakout practice'; // 24 characters
  expect(NAME).toHaveLength(24);
  expect((await request.patch(`${apiUrl()}/backtest/sessions/${session.id}`, { data: { name: NAME } })).status()).toBe(200);

  for (const width of [1280, 1400, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/sessions/${session.id}`);
    await replayStarted(page);
    await page.getByTestId('replay-play').click(); // the widest state: "❚❚ Pause"
    await expect(page.getByTestId('replay-play')).toHaveAttribute('aria-pressed', 'true');

    const name = page.locator('.toolbar .name');
    await expect(name).toHaveText(NAME);
    const n = await name.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(n.scroll, `${width}px: the name is cut (${n.scroll} > ${n.client})`).toBeLessThanOrEqual(n.client);

    const boxes = await page.locator('.toolbar .group').evaluateAll((groups) =>
      groups.filter((g) => g.getBoundingClientRect().width > 0).map((g) => {
        const r = g.getBoundingClientRect();
        return { cls: g.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    for (const b of boxes) expect(b.right, `${width}px: ${b.cls} runs off-screen`).toBeLessThanOrEqual(width);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        expect(overlap, `${width}px: ${a.cls} overlaps ${b.cls}`).toBe(false);
      }
    }
    for (const id of ['replay-cursor', 'replay-step', 'replay-play', 'replay-speed', 'trade-buy', 'trade-sell', 'trade-place', 'positions-toggle', 'replay-open-risk', 'replay-balance']) {
      await expect(page.getByTestId(id), `${width}px: ${id}`).toBeInViewport();
    }
    if (process.env['T062_SHOTS']) {
      const h = await page.locator('.toolbar').evaluate((el) => el.getBoundingClientRect().bottom);
      await page.screenshot({ path: `${process.env['T062_SHOTS']}/toolbar-${width}.png`, clip: { x: 0, y: 0, width, height: Math.ceil(h) + 40 } });
    }
    await page.getByTestId('replay-play').click(); // pause before leaving
  }
});
