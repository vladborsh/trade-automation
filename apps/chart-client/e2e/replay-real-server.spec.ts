import { test, expect, type Page } from '@playwright/test';

/**
 * Tester e2e (cluster bt-workspace): the P0 client flow against the REAL signal-server — the mock
 * holds no orders, so this is the only order-flow end-to-end test. Money is checked twice: the
 * client's journal / statistics / toolbar must equal the server's rows (`GET …/orders`, `…/stats`),
 * and the server's rows must equal independent arithmetic written here from design §6 over the
 * session's own 1m tape (`…/candles/ahead`) — not replay-core, not the code under test.
 *
 *  1. journey     — market long + market short from the keyboard, one closed by hand, the rest walked to
 *                   the period end (force close), completed and inert; journal, summary, balance;
 *  2. preview     — with the advance responses held back, the client's preview of a gap-through stop
 *                   (limit filled and stopped inside one coalesced span) and of a same-candle SL+TP
 *                   equals the server's row once released;
 *  3. robustness  — no order without a draft; 60 quick steps → a handful of requests; the network
 *                   dropping mid-steps loses and duplicates nothing; a second tab's stale op → 409 →
 *                   reload, never a corrupted journal; a reload resumes at the persisted cursor.
 *
 * Skipped unless REAL_API_PORT + REAL_ADMIN_EMAIL + REAL_ADMIN_PASSWORD are set (a signal-server with
 * a database, CORS_ORIGIN = this client's origin, and BTCUSDT 1m history around 2024-03-04, with the
 * derive job already run) and a client dev server listens on E2E_CLIENT_PORT:
 *   REAL_API_PORT=3040 REAL_ADMIN_EMAIL=… REAL_ADMIN_PASSWORD=… E2E_CLIENT_PORT=4240 \
 *     npx playwright test e2e/replay-real-server.spec.ts
 */
const API_PORT = process.env['REAL_API_PORT'];
const ADMIN_EMAIL = process.env['REAL_ADMIN_EMAIL'] ?? '';
const ADMIN_PASSWORD = process.env['REAL_ADMIN_PASSWORD'] ?? '';
test.skip(!API_PORT || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'REAL_API_PORT / REAL_ADMIN_EMAIL / REAL_ADMIN_PASSWORD not set');

const API = `http://localhost:${API_PORT}/api`;
const MIN = 60_000;
const COSTS = { enabled: true, commissionPct: 0.05, spread: 1 };
const LAYOUT = { id: 'rw', name: 'RW', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] };

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Bar = { t: number; o: number; h: number; l: number; c: number };

async function signIn(page: Page): Promise<void> {
  await page.route('**/config.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: API, wsUrl: `ws://localhost:${API_PORT}` }) }),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
}

async function get(page: Page, path: string): Promise<Json> {
  const res = await page.context().request.get(`${API}${path}`);
  expect(res.status(), path).toBe(200);
  return res.json();
}

async function createSession(page: Page, o: { name: string; from: number; to: number; tf: string; costs?: typeof COSTS }): Promise<Json> {
  const res = await page.context().request.post(`${API}/backtest/sessions`, {
    data: {
      name: o.name, layout: LAYOUT, timeframe: o.tf, periodFromMs: o.from, periodToMs: o.to,
      initialBalance: 10_000, defaultRiskPct: 1, costs: o.costs ?? COSTS,
    },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

/** The session's 1m tape from one minute before the period start (the last close before the first step). */
async function tape(page: Page, s: Json, fromMs = s.periodFromMs - MIN): Promise<Bar[]> {
  const out: Bar[] = [];
  let cursor = fromMs;
  for (;;) {
    const r = await get(page, `/backtest/sessions/${s.id}/candles/ahead?panelId=btc&fromMs=${cursor}&limit=5000`);
    for (const [t, o, h, l, c] of r.candles as number[][]) out.push({ t, o, h, l, c });
    if (r.endOfTape || r.candles.length === 0) return out;
    cursor = out[out.length - 1].t + MIN;
  }
}

async function openWorkspace(page: Page, id: string): Promise<void> {
  await page.goto(`/sessions/${id}`);
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('replay-cursor')).toBeVisible();
  // a key pressed in the first ~200 ms after the loading state disappears is dropped (observed, reported as a
  // note to the Tech Lead); give the workspace a moment so the tests exercise the flow, not that window
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------------------------
// Independent §6 arithmetic
// ---------------------------------------------------------------------------------------------

const half = (c = COSTS) => (c.enabled ? c.spread / 2 : 0);
const fee = (notional: number, c = COSTS) => (c.enabled ? (notional * c.commissionPct) / 100 : 0);

interface Expected { status: string; entry: number; entryTime: number; exit?: number; exitTime?: number; reason?: string; sameBar?: boolean }

/** Walks 1m bars [fromCursor, toCursor) for an order; `entry`/`entryTime` given for an already open position. */
function walk(tp: Bar[], o: { side: string; type: string; limit?: number; sl: number; tp: number | null; entry?: number; entryTime?: number }, fromCursor: number, toCursor: number): Expected {
  const long = o.side === 'long';
  let st = o.type === 'limit' ? 'pending' : 'open';
  let entry = o.entry ?? NaN;
  let entryTime = o.entryTime ?? NaN;
  for (const c of tp.filter((b) => b.t >= fromCursor && b.t + MIN <= toCursor)) {
    let fillCandle = false;
    if (st === 'pending') {
      if (long ? c.l <= o.limit! : c.h >= o.limit!) { st = 'open'; entry = o.limit!; entryTime = c.t; fillCandle = true; } else continue;
    }
    const slHit = long ? c.l <= o.sl : c.h >= o.sl;
    const tpHit = o.tp !== null && (long ? c.h >= o.tp : c.l <= o.tp);
    if (slHit) {
      const gap = !fillCandle && (long ? c.o < o.sl : c.o > o.sl);
      const px = gap ? (long ? c.o - half() : c.o + half()) : long ? o.sl - half() : o.sl + half();
      return { status: 'closed', entry, entryTime, exit: px, exitTime: c.t, reason: 'stop', sameBar: tpHit };
    }
    if (tpHit) {
      const gap = !fillCandle && (long ? c.o > o.tp! : c.o < o.tp!);
      return { status: 'closed', entry, entryTime, exit: gap ? c.o : o.tp!, exitTime: c.t, reason: 'take-profit', sameBar: false };
    }
  }
  return { status: st, entry, entryTime };
}

function pnlOf(side: string, entry: number, exit: number, qty: number, risk: number): { pnl: number; r: number; commission: number } {
  const commission = fee(entry * qty) + fee(exit * qty);
  const pnl = (side === 'long' ? 1 : -1) * (exit - entry) * qty - commission;
  return { pnl, r: pnl / risk, commission };
}

const close = (a: number, b: number, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const fmtMoney = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)} USD`;

/** The journal's cells for each row, keyed by data-field → raw value. */
async function journal(page: Page): Promise<Record<string, Record<string, string | null>>> {
  return page.getByTestId('journal-row').evaluateAll((rows) =>
    Object.fromEntries(
      rows.map((r) => [
        r.getAttribute('data-order-id') as string,
        Object.fromEntries([...r.querySelectorAll('td[data-field]')].map((td) => [td.getAttribute('data-field') as string, td.getAttribute('data-value')])),
      ]),
    ),
  );
}
async function stats(page: Page): Promise<Record<string, string | null>> {
  return page.locator('[data-stat]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-stat') as string, e.getAttribute('data-value')])));
}

// ---------------------------------------------------------------------------------------------

test('journey: keyboard orders, a manual close, the period end; every number equals the server and independent arithmetic', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw journey ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m' });
  const tp = await tape(page, s);
  await openWorkspace(page, s.id);

  const step = async (n: number) => { for (let i = 0; i < n; i++) await page.keyboard.press('ArrowRight'); };
  const serverCursor = async () => (await get(page, `/backtest/sessions/${s.id}`)).session.cursorMs as number;
  const settle = async (expected: number) => expect.poll(serverCursor, { timeout: 15_000 }).toBe(expected);

  await step(1); await settle(from + 5 * MIN);
  await page.keyboard.press('b'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('position-1')).toBeVisible();
  await step(3); await settle(from + 20 * MIN);
  await page.keyboard.press('s'); await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid^="position-"]').filter({ hasText: 'short' })).toBeVisible();
  await step(2); await settle(from + 30 * MIN);

  // one open position is closed by hand from the positions panel
  const closeBtn = page.getByRole('button', { name: 'Close' }).first();
  await expect(closeBtn, 'a position must still be open at 10:30 for the manual-close leg of this window').toBeVisible();
  await closeBtn.click();
  await expect.poll(async () => (await get(page, `/backtest/sessions/${s.id}/orders`)).filter((o: Json) => o.closeReason === 'manual').length).toBe(1);

  // walk to the period end with the keyboard
  for (let i = 0; i < 40 && (await page.getByTestId('replay-completed').count()) === 0; i++) { await step(1); await page.waitForTimeout(60); }
  await expect(page.getByTestId('replay-completed')).toBeVisible({ timeout: 15_000 });

  // inert once completed: no step, no draft, no order
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/(advance|orders)/.test(r.url())) posts.push(r.url()); });
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('b'); await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);

  // ---- the server's rows, against independent arithmetic ----
  const orders: Json[] = await get(page, `/backtest/sessions/${s.id}/orders`);
  const st = await get(page, `/backtest/sessions/${s.id}/stats`);
  const sess = (await get(page, `/backtest/sessions/${s.id}`)).session;
  expect(sess.status).toBe('complete');
  expect(orders.length).toBe(2);
  const lastClose = (cursor: number) => tp.filter((b) => b.t + MIN <= cursor).at(-1)!.c;
  const results: { o: Json; pnl: number; r: number; exitCursor: number }[] = [];
  let balance = 10_000;
  for (const o of [...orders].sort((a, b) => a.seq - b.seq)) {
    const lc = lastClose(o.placedAtMs);
    const risk = balance * 0.01; // no earlier close changes the balance before the second placement unless it closed already
    // balance at placement: closed results whose exit happened at or before this placement
    const bal = 10_000 + results.filter((x) => x.exitCursor <= o.placedAtMs).reduce((a, x) => a + x.pnl, 0);
    const riskAmount = bal * 0.01;
    const qty = riskAmount / Math.abs(lc - o.slInitial);
    const entry = lc + (o.side === 'long' ? half() : -half());
    expect(close(o.qty, qty, 1e-6), `#${o.seq} qty`).toBe(true);
    expect(close(o.riskAmountCcy, riskAmount, 1e-6), `#${o.seq} risk`).toBe(true);
    expect(close(o.entryPrice, entry), `#${o.seq} entry`).toBe(true);
    void risk;
    let exit: number; let exitCursor: number; let reason: string;
    if (o.closeReason === 'manual') {
      exitCursor = o.exitTimeMs + MIN; reason = 'manual';
      exit = lastClose(exitCursor) + (o.side === 'long' ? -half() : half());
    } else if (o.closeReason === 'end-of-session') {
      exitCursor = s.periodToMs; reason = 'end-of-session';
      exit = lastClose(exitCursor) + (o.side === 'long' ? -half() : half());
    } else {
      const w = walk(tp, { side: o.side, type: 'market', sl: o.slInitial, tp: o.tpInitial, entry, entryTime: o.entryTimeMs }, o.placedAtMs, s.periodToMs);
      expect(w.status, `#${o.seq} walk`).toBe('closed');
      exit = w.exit!; exitCursor = w.exitTime! + MIN; reason = w.reason!;
      expect(o.exitTimeMs, `#${o.seq} exit time`).toBe(w.exitTime);
    }
    expect(o.closeReason, `#${o.seq} reason`).toBe(reason);
    expect(close(o.exitPrice, exit), `#${o.seq} exit ${o.exitPrice} vs ${exit}`).toBe(true);
    const m = pnlOf(o.side, entry, exit, o.qty, o.riskAmountCcy);
    expect(close(o.commissionCcy, m.commission, 1e-6), `#${o.seq} commission`).toBe(true);
    expect(close(o.pnlCcy, m.pnl, 1e-6), `#${o.seq} pnl`).toBe(true);
    expect(close(o.pnlR, m.r, 1e-5), `#${o.seq} R`).toBe(true);
    results.push({ o, pnl: m.pnl, r: m.r, exitCursor });
  }
  const totalPnl = results.reduce((a, x) => a + x.pnl, 0);
  expect(close(sess.balance, 10_000 + totalPnl, 1e-8), 'balance').toBe(true);
  const c = st.computed;
  expect(c.trades).toBe(2);
  expect(close(c.pnl, totalPnl, 1e-6)).toBe(true);
  expect(close(c.pnlR, results.reduce((a, x) => a + x.r, 0), 1e-5)).toBe(true);
  expect(c.wins).toBe(results.filter((x) => x.pnl > 0).length);
  expect(st.drift).toBe(false);

  // ---- the client shows exactly the server's numbers ----
  const rows = await journal(page);
  expect(Object.keys(rows).sort()).toEqual(orders.map((o) => o.id).sort());
  for (const o of orders) {
    const r = rows[o.id];
    expect(r['status'], `row ${o.seq} status`).toBe(o.status);
    for (const [field, key] of [['entryPrice', 'entryPrice'], ['exitPrice', 'exitPrice'], ['qty', 'qty'], ['commissionCcy', 'commissionCcy'], ['spreadCostCcy', 'spreadCostCcy'], ['pnlCcy', 'pnlCcy'], ['pnlR', 'pnlR'], ['maeR', 'maeR']] as const) {
      expect(close(Number(r[field]), o[key], 1e-9), `journal #${o.seq} ${field}: ${r[field]} vs ${o[key]}`).toBe(true);
    }
    expect(r['closeReason']).toBe(o.closeReason);
  }
  const shown = await stats(page);
  for (const [k, v] of [['trades', c.trades], ['pnl', c.pnl], ['pnlR', c.pnlR], ['maxDrawdownCcy', c.maxDrawdownCcy], ['maxDrawdownR', c.maxDrawdownR]] as const) {
    expect(close(Number(shown[k]), v, 1e-9), `summary ${k}: ${shown[k]} vs ${v}`).toBe(true);
  }
  await expect(page.getByTestId('replay-balance')).toHaveText(new RegExp(`^${Math.abs(sess.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace('.', '\\.')}`));
  await expect(page.locator('[data-stat="pnl"] dd')).toHaveText(fmtMoney(c.pnl));
  await expect(page.getByTestId('replay-open-risk')).toContainText('0.00');
});

// ---------------------------------------------------------------------------------------------

test('preview vs server: a limit filled and stopped through a gap inside one coalesced span, and a same-candle SL+TP', async ({ page }) => {
  await signIn(page);
  const scenarios: { name: string; from: number; steps: number; place: (lc: number) => Json; find?: never }[] = [];
  void scenarios;

  // -- gap-through: short limit 67070.8 / stop 67135.95 at 2024-03-04 17:48 fills at 17:48 and stops at 17:54 on a gap up
  const gapFrom = Date.UTC(2024, 2, 4, 17, 48);
  const gap = await createSession(page, { name: `rw gap ${Date.now()}`, from: gapFrom, to: gapFrom + 4 * 60 * MIN, tf: '1m' });
  const gapTape = await tape(page, gap);
  const place = (s: Json, cursorMs: number, body: Json) => page.context().request.post(`${API}/backtest/sessions/${s.id}/orders`, { data: { opId: crypto.randomUUID(), cursorMs, panelId: 'btc', riskPct: 1, ...body } });
  expect((await place(gap, gapFrom, { side: 'short', type: 'limit', limitPrice: 67070.8, sl: 67135.95, tp: 65070.8 })).status()).toBe(201);

  // -- same candle: a 1m candle whose range reaches both ±100 around the previous close
  const day = await tape(page, gap, Date.UTC(2024, 2, 4, 0, 0) - MIN);
  const k = day.findIndex((b, i) => i > 0 && b.l <= day[i - 1].c - 100 && b.h >= day[i - 1].c + 100 && Math.abs(b.o - day[i - 1].c) < 99);
  expect(k, 'a same-candle SL+TP window exists on 2024-03-04').toBeGreaterThan(0);
  const sameFrom = day[k].t;
  const same = await createSession(page, { name: `rw same ${Date.now()}`, from: sameFrom, to: sameFrom + 60 * MIN, tf: '1m' });
  const sameLc = day[k - 1].c;
  expect((await place(same, sameFrom, { side: 'long', type: 'market', sl: sameLc - 100, tp: sameLc + 100 })).status()).toBe(201);

  for (const c of [
    { s: gap, steps: 8, tape: gapTape, order: { side: 'short', type: 'limit', limit: 67070.8, sl: 67135.95, tp: 65070.8 } },
    { s: same, steps: 1, tape: day, order: { side: 'long', type: 'market', sl: sameLc - 100, tp: sameLc + 100 } },
  ]) {
    const p = await page.context().newPage();
    await p.route('**/config.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: API, wsUrl: `ws://localhost:${API_PORT}` }) }));
    await openWorkspace(p, c.s.id);
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let held = 0;
    await p.route('**/advance', async (route) => { held++; await gate; await route.continue(); });
    for (let i = 0; i < c.steps; i++) await p.keyboard.press('ArrowRight');
    await expect.poll(() => held, { timeout: 5_000 }).toBeGreaterThan(0);

    // the preview (server has not answered): the order is already closed in the client's journal
    await expect(p.getByTestId('journal-row').first().locator('td[data-field="status"]')).toHaveAttribute('data-value', 'closed', { timeout: 5_000 });
    const preview = Object.values(await journal(p))[0];
    release();
    await expect.poll(async () => (await get(p, `/backtest/sessions/${c.s.id}`)).session.cursorMs).toBe(c.s.periodFromMs + c.steps * MIN);
    await expect.poll(async () => (await get(p, `/backtest/sessions/${c.s.id}/orders`))[0].status).toBe('closed');
    const server = (await get(p, `/backtest/sessions/${c.s.id}/orders`))[0];

    // preview == server row, and the server row == independent arithmetic
    for (const f of ['entryPrice', 'exitPrice', 'commissionCcy', 'spreadCostCcy', 'pnlCcy', 'pnlR'] as const) {
      expect(close(Number(preview[f]), server[f], 1e-9), `${c.order.type} preview ${f}: ${preview[f]} vs server ${server[f]}`).toBe(true);
    }
    expect(preview['closeReason']).toBe(server.closeReason);
    const w = walk(c.tape, c.order, c.s.periodFromMs, c.s.periodFromMs + c.steps * MIN);
    expect(w.status).toBe('closed');
    const entry = c.order.type === 'limit' ? c.order.limit! : server.entryPrice;
    if (c.order.type === 'market') expect(close(server.entryPrice, sameLc + half())).toBe(true);
    expect(close(server.exitPrice, w.exit!), `${c.order.type} exit ${server.exitPrice} vs ${w.exit}`).toBe(true);
    expect(server.closeReason).toBe(w.reason);
    expect(server.exitTimeMs).toBe(w.exitTime);
    expect(server.slTpSameBar).toBe(!!w.sameBar);
    const m = pnlOf(server.side, entry, w.exit!, server.qty, server.riskAmountCcy);
    expect(close(server.pnlCcy, m.pnl, 1e-6)).toBe(true);
    expect(close(server.commissionCcy, m.commission, 1e-6)).toBe(true);
    await p.close();
  }
});

// ---------------------------------------------------------------------------------------------

test('robustness: never a guessed order, quick stepping, a dropped network, a stale second tab, a reload', async ({ page, context }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw robust ${Date.now()}`, from, to: from + 2 * 86_400_000, tf: '5m' });
  const serverCursor = async () => (await get(page, `/backtest/sessions/${s.id}`)).session.cursorMs as number;
  const orderCount = async () => (await get(page, `/backtest/sessions/${s.id}/orders`)).length as number;
  const advances: { opId: string; to: number }[] = [];
  const orderPosts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST') return;
    if (r.url().includes('/advance')) { const b = JSON.parse(r.postData() ?? '{}'); advances.push({ opId: b.opId, to: b.toCursorMs }); }
    if (/\/orders$/.test(r.url())) orderPosts.push(r.url());
  });
  await openWorkspace(page, s.id);

  // decision 29: no key sequence creates an order without an active draft
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.press('b'); await page.keyboard.press('Escape'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  expect(orderPosts).toEqual([]);
  expect(await orderCount()).toBe(0);
  await expect(page.locator('body')).toContainText(/press B or S/);

  // 60 quick steps: a handful of requests, and the cursors agree
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  await expect.poll(serverCursor, { timeout: 15_000 }).toBe(from + 60 * 5 * MIN);
  expect(advances.length).toBeLessThanOrEqual(6);
  expect(new Set(advances.map((a) => a.opId)).size).toBe(advances.length);
  await expect(page.getByTestId('replay-cursor')).toHaveText(/2024-03-04 15:00 UTC/);

  // the network drops (aborted, then 503) in the middle of stepping: identical retries, nothing lost, nothing doubled
  let mode: 'ok' | 'abort' | '503' = 'abort';
  const seen: { opId: string; to: number; mode: string }[] = [];
  await page.route('**/advance', async (route) => {
    const b = JSON.parse(route.request().postData() ?? '{}');
    seen.push({ opId: b.opId, to: b.toCursorMs, mode });
    if (mode === 'abort') return route.abort('connectionfailed');
    if (mode === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down"}' });
    return route.continue();
  });
  const before = await serverCursor();
  for (const m of ['abort', '503'] as const) {
    mode = m;
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('replay-retrying')).toBeVisible({ timeout: 5_000 });
    mode = 'ok';
    await expect(page.getByTestId('replay-retrying')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(serverCursor, { timeout: 15_000 }).toBe(before + (m === 'abort' ? 3 : 6) * 5 * MIN);
  }
  const retried = new Map<string, number[]>();
  for (const x of seen.filter((y) => y.mode !== 'ok')) retried.set(x.opId, [...(retried.get(x.opId) ?? []), x.to]);
  for (const targets of retried.values()) expect(new Set(targets).size, 'a retry must be byte-identical (same target)').toBe(1);
  await page.unroute('**/advance');

  // a second tab that has gone stale: its step is refused (409), it reloads with a notice, the journal is untouched
  const tab2 = await context.newPage();
  await tab2.route('**/config.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: API, wsUrl: `ws://localhost:${API_PORT}` }) }));
  await openWorkspace(tab2, s.id);
  await page.bringToFront();
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight');
  const settled = before + 8 * 5 * MIN; // 3 + 3 steps of the drop test, then these 2
  await expect.poll(serverCursor, { timeout: 15_000 }).toBe(settled);
  await tab2.bringToFront();
  await tab2.keyboard.press('b'); await tab2.keyboard.press('Enter'); // a stale placement
  await expect(tab2.getByTestId('replay-notice')).toContainText('moved on elsewhere', { timeout: 10_000 });
  expect(await serverCursor()).toBe(settled);
  expect(await orderCount()).toBe(0); // the stale tab created nothing
  await tab2.keyboard.press('ArrowRight');
  await expect.poll(serverCursor, { timeout: 10_000 }).toBe(settled + 5 * MIN); // reloaded tab steps from the persisted cursor

  // a reload resumes at the persisted cursor
  const persisted = await serverCursor();
  await tab2.reload();
  await expect(tab2.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15_000 });
  const text = await tab2.getByTestId('replay-cursor').innerText();
  expect(text).toContain(new Date(persisted).toISOString().slice(0, 16).replace('T', ' '));
});

test('view-only (show on chart): no key creates a draft, an order or a step', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw viewonly ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m' });
  const placed = await page.context().request.post(`${API}/backtest/sessions/${s.id}/orders`, {
    data: { opId: crypto.randomUUID(), cursorMs: from, panelId: 'btc', riskPct: 1, side: 'long', type: 'market', sl: 60_000 },
  });
  expect(placed.status()).toBe(201);
  const order = (await placed.json()).order;
  await page.goto(`/sessions/${s.id}?viewAt=${from}&order=${order.id}`);
  await expect(page.getByTestId('replay-viewing')).toBeVisible({ timeout: 15_000 });
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
  for (const key of ['ArrowRight', 'b', 's', 'Enter', 'Enter', 'Escape', 'Enter']) await page.keyboard.press(key);
  await page.waitForTimeout(600);
  expect(posts).toEqual([]);
  expect((await get(page, `/backtest/sessions/${s.id}/orders`)).length).toBe(1);
  expect((await get(page, `/backtest/sessions/${s.id}`)).session.cursorMs).toBe(from);
});
