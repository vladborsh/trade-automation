import { test, expect, type Page } from '@playwright/test';
import { openJournal, openStatsDetails, replayStarted } from './fixtures';

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

async function createSession(page: Page, o: { name: string; from: number; to: number; tf: string; costs?: typeof COSTS; initialBalance?: number }): Promise<Json> {
  const res = await page.context().request.post(`${API}/backtest/sessions`, {
    data: {
      name: o.name, layout: LAYOUT, timeframe: o.tf, periodFromMs: o.from, periodToMs: o.to,
      initialBalance: o.initialBalance ?? 10_000, defaultRiskPct: 1, costs: o.costs ?? COSTS,
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

/** T-046: the positions list is a toolbar dropdown; opens it unless it is open already. */
async function showPositions(page: Page): Promise<void> {
  if ((await page.getByTestId('positions-dropdown').count()) === 0) await page.getByTestId('positions-toggle').click();
  await expect(page.getByTestId('positions-dropdown')).toBeVisible();
}

/** T-045: B/S draws a draft (never the popup); Enter opens the order popup — the submit step; Enter confirms. */
async function placeFromKeyboard(page: Page, key: 'b' | 's'): Promise<void> {
  await page.keyboard.press(key);
  await expect(page.getByTestId('order-popup')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('order-popup')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('order-popup')).toHaveCount(0);
}

async function openWorkspace(page: Page, id: string): Promise<void> {
  await page.goto(`/sessions/${id}`);
  // BUG-009/BUG-010: the one readiness wait — the engine's first history is in. `replay-loading` count 0 also holds
  // on the blank page before the toolbar exists, and a key pressed during the load is blocked by design.
  await replayStarted(page);
  await openJournal(page); // T-043: collapsed by default; these tests read its rows
  await openStatsDetails(page); // T-044: P&L only by default; these tests read every figure
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

/**
 * BUG-015: design §6 D12 — the size is rounded DOWN to the contract's qtyStep (written here, not
 * imported from replay-core). A 1e-9 relative slack keeps a float a hair below a step on that step.
 */
function floorToStep(value: number, step: number): number {
  const n = Math.floor((value / step) * (1 + 1e-9));
  return n <= 0 ? 0 : n * step;
}

/** The instrument's D12 contract from `GET /backtest/instruments`; `null` (no block) sizes unrounded at multiplier 1. */
async function contractOf(page: Page, instrument: string): Promise<{ multiplier: number; qtyStep: number } | null> {
  const list: Json[] = await get(page, '/backtest/instruments');
  const inst = list.find((i) => i.id === instrument);
  expect(inst, `instrument ${instrument} listed`).toBeTruthy();
  return inst.contract;
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
  await placeFromKeyboard(page, 'b');
  await showPositions(page);
  await expect(page.getByTestId('position-1')).toBeVisible();
  await step(3); await settle(from + 20 * MIN);
  await placeFromKeyboard(page, 's');
  await showPositions(page);
  await expect(page.locator('[data-testid^="position-"]').filter({ hasText: 'short' })).toBeVisible();
  await step(2); await settle(from + 30 * MIN);

  // one open position is closed by hand from the positions dropdown
  await showPositions(page);
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
  const contract = await contractOf(page, 'binance:BTCUSDT');
  const multiplier = contract?.multiplier ?? 1;
  const results: { o: Json; pnl: number; r: number; exitCursor: number }[] = [];
  let balance = 10_000;
  for (const o of [...orders].sort((a, b) => a.seq - b.seq)) {
    const lc = lastClose(o.placedAtMs);
    const risk = balance * 0.01; // no earlier close changes the balance before the second placement unless it closed already
    // balance at placement: closed results whose exit happened at or before this placement
    const bal = 10_000 + results.filter((x) => x.exitCursor <= o.placedAtMs).reduce((a, x) => a + x.pnl, 0);
    const requestedRisk = bal * 0.01;
    // D12 (BUG-015): sized at the last close, rounded down to the step; 1R = qty × distance × multiplier ≤ requested
    const distance = Math.abs(lc - o.slInitial);
    const raw = requestedRisk / (distance * multiplier);
    const qty = contract ? floorToStep(raw, contract.qtyStep) : raw;
    const riskAmount = qty * distance * multiplier;
    const entry = lc + (o.side === 'long' ? half() : -half());
    expect(close(o.qty, qty, 1e-6), `#${o.seq} qty ${o.qty} vs ${qty}`).toBe(true);
    expect(close(o.riskAmountCcy, riskAmount, 1e-6), `#${o.seq} risk ${o.riskAmountCcy} vs ${riskAmount}`).toBe(true);
    expect(o.riskAmountCcy, `#${o.seq} risk within the requested`).toBeLessThanOrEqual(requestedRisk * (1 + 1e-9));
    expect(o.riskPct, `#${o.seq} riskPct is the requested one`).toBe(1);
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
  await placeFromKeyboard(tab2, 'b'); // a stale placement
  await expect(tab2.getByTestId('replay-notice')).toContainText('moved on elsewhere', { timeout: 10_000 });
  expect(await serverCursor()).toBe(settled);
  expect(await orderCount()).toBe(0); // the stale tab created nothing
  // BUG-009: the refusal retires the old engine (not started) until the fresh one is up; a key before that is ignored
  await replayStarted(tab2);
  await tab2.keyboard.press('ArrowRight');
  await expect.poll(serverCursor, { timeout: 10_000 }).toBe(settled + 5 * MIN); // reloaded tab steps from the persisted cursor

  // a reload resumes at the persisted cursor
  const persisted = await serverCursor();
  await tab2.reload();
  await replayStarted(tab2);
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

test('T-037: a → pressed while a step or switch is in flight is queued, never lost; holding → steps continuously', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw hold ${Date.now()}`, from, to: from + 24 * 60 * MIN, tf: '5m' });
  const serverCursor = async () => (await get(page, `/backtest/sessions/${s.id}`)).session.cursorMs as number;
  const refused: number[] = [];
  page.on('response', (r) => { if (r.url().endsWith('/advance') && r.status() >= 400) refused.push(r.status()); });
  await openWorkspace(page, s.id);

  // 1. the lost-key case, made deterministic: `]` starts a timeframe switch (a server round trip), → lands
  //    while it is in flight. Before T-037 the → was dropped; now it is shown as queued and runs after the switch.
  //    The switch's history request is held until → is in, so the press lands mid-switch every run.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/backtest\/sessions\/[^/]+\/candles\?/, async (route) => { await held; await route.continue(); });
  await page.keyboard.press(']'); // 5m → 15m
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('replay-step-queued')).toHaveCount(1);
  expect(await serverCursor()).toBe(from); // nothing stepped yet: the switch is still in flight
  release();
  await page.unroute(/\/backtest\/sessions\/[^/]+\/candles\?/);
  await expect.poll(serverCursor, { timeout: 10_000 }).toBe(from + 15 * MIN);
  await expect(page.getByTestId('replay-step-queued')).toHaveCount(0);
  // back to 1m for many small steps below (a switch press is not queued — T-037 is about steps — so one at a time)
  for (const tf of ['5m', '1m']) {
    await page.keyboard.press('[');
    await expect(page.locator('.tf-btn.active')).toHaveText(tf, { timeout: 10_000 });
    await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 10_000 });
  }

  // 2. hold → for 2 s (key repeat ≈ 30/s): the on-screen cursor keeps moving the whole time
  await page.evaluate(() => {
    const w = window as unknown as { cursorLog: [number, string][] };
    w.cursorLog = [];
    const el = () => document.querySelector('[data-testid="replay-cursor"]')?.textContent ?? '';
    let last = '';
    setInterval(() => { const t = el(); if (t !== last) { last = t; w.cursorLog.push([performance.now(), t]); } }, 10);
  });
  const before = await serverCursor();
  const t0 = Date.now();
  let presses = 0;
  while (Date.now() - t0 < 2_000) {
    await page.keyboard.down('ArrowRight'); // a held key: repeated keydowns
    presses++;
    await page.waitForTimeout(33);
  }
  await page.keyboard.up('ArrowRight');
  const log = await page.evaluate(() => (window as unknown as { cursorLog: [number, string][] }).cursorLog);
  const changes = log.length;
  const gaps = log.slice(1).map(([t], i) => t - log[i][0]);
  // released: a queued press still runs, then everything settles and the server agrees with the screen
  await expect(page.getByTestId('replay-step-queued')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 10_000 });
  const screen = await page.getByTestId('replay-cursor').innerText();
  await expect.poll(async () => new Date(await serverCursor()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC', { timeout: 10_000 }).toBe(screen);
  const steps = ((await serverCursor()) - before) / MIN;
  console.log(`T-037 hold: ${presses} keydowns in 2 s → ${steps} steps; ${changes} cursor changes on screen, longest pause ${Math.round(Math.max(...gaps))} ms`);
  expect(steps).toBeGreaterThanOrEqual(20); // continuous: most repeats are steps
  expect(steps).toBeLessThanOrEqual(presses); // never more steps than presses (no backlog replayed)
  expect(Math.max(...gaps)).toBeLessThan(500); // no stall while the key was down
  expect(refused).toEqual([]);
});

test('T-045: B → drag the stop → Enter → the order popup → Confirm → the order, with the dragged stop', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw popup ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m' });
  await openWorkspace(page, s.id);
  const body = page.locator('.chart-panel[data-panel-id="btc"] .panel-body');
  const container = body.locator('.chart-container');
  const box = (await container.boundingBox())!;
  const tools = async () => ((await body.getAttribute('data-position-tools')) ?? '').split(' ').filter(Boolean).map((t) => t.split(':'));
  const priceAt = async (y: number) => {
    await page.mouse.move(box.x + box.width * 0.4, y);
    await expect(body).toHaveAttribute('data-pointer-price', /\d/);
    return Number(await body.getAttribute('data-pointer-price'));
  };
  const y1 = box.y + box.height * 0.25, y2 = box.y + box.height * 0.75;
  const p1 = await priceAt(y1), p2 = await priceAt(y2);
  const yOf = (price: number) => y1 + ((price - p1) * (y2 - y1)) / (p2 - p1);

  // B with the pointer off the chart: a market draft; no popup while its levels are set
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.keyboard.press('b');
  await expect.poll(async () => (await tools()).length).toBe(1);
  const [id, , , , sl0] = (await tools())[0];
  await expect(page.getByTestId('order-popup')).toHaveCount(0);

  // drag its stop handle 25 px down (the handle is found by scanning its level for the hover hook)
  const slY = yOf(Number(sl0));
  let handleX: number | null = null;
  for (let x = box.x + 2; x < box.x + box.width - 60 && handleX === null; x += 3) {
    await page.mouse.move(x, slY);
    if ((await container.getAttribute('data-position-tool-hover')) === `handle:sl:${id}`) handleX = x;
  }
  expect(handleX, 'the draft has a stop handle').not.toBeNull();
  await page.mouse.down();
  await page.mouse.move(handleX!, slY + 12, { steps: 3 });
  await expect(page.getByTestId('order-popup')).toHaveCount(0); // dragging is unobstructed
  await page.mouse.move(handleX!, slY + 25, { steps: 3 });
  await page.mouse.up();
  const sl1 = Number((await tools())[0][4]);
  expect(sl1).toBeLessThan(Number(sl0));
  await expect(page.getByTestId('order-popup')).toHaveCount(0);

  // Enter: the submit step — the popup, sized from the dragged stop
  await page.mouse.move(box.x + box.width / 2, box.y - 40);
  await page.keyboard.press('Enter');
  const popup = page.getByTestId('order-popup');
  await expect(popup).toBeVisible();
  const qtyShown = Number((await popup.getByTestId('order-qty').innerText()).replace(/[^\d.]/g, '')); // "0.165 BTC" (T-054)
  expect((await get(page, `/backtest/sessions/${s.id}/orders`)).length).toBe(0); // nothing placed yet
  if (process.env['T045_SHOTS']) await page.screenshot({ path: `${process.env['T045_SHOTS']}/order-popup.png` });

  await popup.getByTestId('order-confirm').click();
  await expect(popup).toHaveCount(0);
  await expect.poll(async () => (await get(page, `/backtest/sessions/${s.id}/orders`)).length, { timeout: 10_000 }).toBe(1);
  await showPositions(page);
  const [order] = await get(page, `/backtest/sessions/${s.id}/orders`);
  expect(order).toMatchObject({ side: 'long', type: 'market', status: 'open', slInitial: sl1 });
  // D12: both size at the planned entry (the last close) on the venue step — the spread never re-sizes it
  expect(order.qty).toBe(qtyShown);
  await expect(page.getByTestId('position-1')).toBeVisible();
  if (process.env['T045_SHOTS']) await page.screenshot({ path: `${process.env['T045_SHOTS']}/after-confirm.png` });
});

test('T-048: by clicks only — Buy → Place → Confirm places an order; Positions → Close closes it', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw clicks ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m' });
  await openWorkspace(page, s.id);
  const orders = async () => get(page, `/backtest/sessions/${s.id}/orders`) as Promise<Json[]>;

  await page.getByTestId('trade-buy').click();
  await page.getByTestId('trade-place').click();
  const popup = page.getByTestId('order-popup');
  await expect(popup).toBeVisible();
  expect(await orders()).toEqual([]); // the popup is the submit step
  await popup.getByTestId('order-confirm').click();
  await expect(popup).toHaveCount(0);
  await expect.poll(async () => (await orders()).map((o) => [o.side, o.type, o.status]), { timeout: 10_000 }).toEqual([['long', 'market', 'open']]);

  // closed by hand before any step: a step could reach the draft's tight default stop first
  await page.getByTestId('positions-toggle').click();
  await page.getByTestId('positions-dropdown').getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => (await orders()).map((o) => [o.status, o.closeReason]), { timeout: 10_000 }).toEqual([['closed', 'manual']]);

  await page.getByTestId('replay-step').click(); // and a step by click too
  await expect.poll(async () => (await get(page, `/backtest/sessions/${s.id}`)).session.cursorMs, { timeout: 10_000 }).toBe(from + 5 * MIN);
  if (process.env['T048_SHOTS']) {
    await page.getByTestId('trade-buy').hover();
    await page.screenshot({ path: `${process.env['T048_SHOTS']}/toolbar-trade-controls.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 } });
  }
});


test('T-054: the popup sizes on the venue step with unit and margin; Confirm places that size; below the venue minimum it cannot be confirmed', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  const s = await createSession(page, { name: `rw margin ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m' });
  await openWorkspace(page, s.id);
  const orders = async () => get(page, `/backtest/sessions/${s.id}/orders`) as Promise<Json[]>;
  const popup = page.getByTestId('order-popup');

  // B → Enter: size in BTC on the venue step, the margin, leverage against the 125× cap
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await expect(popup.getByTestId('order-qty')).toHaveText(/^\d+\.\d{3} BTC$/);
  await expect(popup.getByTestId('order-margin')).toHaveText(/^[\d,]+\.\d{2} USD$/);
  await expect(popup.getByTestId('order-leverage')).toHaveText(/x of 125x$/);
  const shown = Number((await popup.getByTestId('order-qty').innerText()).replace(/[^\d.]/g, ''));
  if (process.env['T054_SHOTS']) await page.screenshot({ path: `${process.env['T054_SHOTS']}/popup-margin.png` });
  await popup.getByTestId('order-confirm').click();
  await expect.poll(async () => (await orders()).length, { timeout: 10_000 }).toBe(1);
  expect((await orders())[0].qty).toBe(shown); // the server sized exactly what the popup showed
  await expect(page.getByTestId('replay-margin')).toHaveText(/^margin \d+ %$/);

  // a second draft at a risk far too small for the venue minimum: the reason, the risk % needed, no Confirm
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await popup.locator('input[name="riskPct"]').fill('0.0001');
  await popup.locator('input[name="riskPct"]').dispatchEvent('change');
  await expect(popup.getByTestId('order-problem')).toContainText('Below the venue minimum');
  await expect(popup.getByTestId('order-problem')).toContainText(/needs a risk of at least [\d.]+ %/);
  await expect(popup.getByTestId('order-confirm')).toBeDisabled();
  if (process.env['T054_SHOTS']) await page.screenshot({ path: `${process.env['T054_SHOTS']}/popup-below-minimum.png` });
  await page.keyboard.press('Enter'); // Enter in the risk field submits the form: refused as well, nothing sent
  await page.waitForTimeout(500);
  expect((await orders()).length).toBe(1);
});

test('T-059: a close past the numeric limit is a terminal 422 — one request, no retry, no reload; the session halts', async ({ page }) => {
  await signIn(page);
  const from = Date.UTC(2024, 2, 4, 10, 0);
  // 1e4 below the 1e12 limit, costs off: any winning close lifts the balance past numeric(20,8)
  const s = await createSession(page, { name: `rw limit ${Date.now()}`, from, to: from + 3 * 60 * MIN, tf: '5m', costs: { enabled: false, commissionPct: 0, spread: 0 }, initialBalance: 1e12 - 1e4 });
  const tp = await tape(page, s);
  const lc0 = tp.filter((b) => b.t + MIN <= from).at(-1)!.c;
  // a long whose target the tape reaches, with a stop below every low before it (never stopped first)
  const hitAt = tp.findIndex((b) => b.t >= from && b.h >= lc0 + 20);
  expect(hitAt, 'the window must rally 20 above the first close').toBeGreaterThan(0);
  const sl = Math.floor(Math.min(...tp.slice(0, hitAt + 1).map((b) => b.l)) - 50);
  const placed = await page.context().request.post(`${API}/backtest/sessions/${s.id}/orders`, {
    data: { opId: crypto.randomUUID(), cursorMs: from, panelId: 'btc', side: 'long', type: 'market', sl, tp: lc0 + 20, riskPct: 1 },
  });
  expect(placed.status(), await placed.text()).toBe(201);

  await openWorkspace(page, s.id);
  const advances: number[] = [];
  const sessionGets: string[] = [];
  page.on('response', (r) => {
    if (r.request().method() === 'POST' && r.url().endsWith('/advance')) advances.push(r.status());
    if (r.request().method() === 'GET' && r.url().endsWith(`/backtest/sessions/${s.id}`)) sessionGets.push(r.url());
  });
  for (let i = 0; i < 40 && (await page.getByTestId('replay-halted').count()) === 0; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('replay-halted')).toHaveText('This session has reached the numeric limit; create a new session');
  await page.waitForTimeout(1_500); // past the first backoffs: a retried 5xx would show here
  expect(advances.filter((st) => st !== 200)).toEqual([422]); // one refusal, never resent
  expect(sessionGets).toEqual([]); // and never reloaded

  // the server rolled the closing advance back: the order is open, the balance untouched
  const [order] = await get(page, `/backtest/sessions/${s.id}/orders`);
  expect(order.status).toBe('open');
  const sess = (await get(page, `/backtest/sessions/${s.id}`)).session;
  expect(sess.balance).toBe(1e12 - 1e4);
  // …and so does the client: the journal drops its preview of that close (the row is open again)
  const rows = await journal(page);
  expect(rows[order.id]['status']).toBe('open');

  // halted: no step, no draft, no order; the notice stays
  const sent = advances.length;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('b');
  await expect(page.getByTestId('replay-step')).toBeDisabled();
  await expect(page.getByTestId('trade-buy')).toBeDisabled();
  await expect(page.getByTestId('replay-play')).toBeDisabled(); // T-052's auto-advance cannot start either
  await page.waitForTimeout(500);
  expect(advances.length).toBe(sent);
  expect(await get(page, `/backtest/sessions/${s.id}/orders`)).toHaveLength(1);
  await expect(page.getByTestId('replay-halted')).toBeVisible();
  if (process.env['T059_SHOTS']) await page.screenshot({ path: `${process.env['T059_SHOTS']}/halted.png` });
});
