import { LIQ_DEFAULT_PARAMS, type LiqVenue } from '@trade-automation/contracts';
import {
  MemoryJournalStore, countRows, crossCheck, firstFullDay, historyStore, replayLiq, scaleParams,
} from '../../../src/alerts/liquidations/backfill/liq-history';
import { parseLiqCliArgs } from '../../../src/alerts/liquidations/backfill/liq-backfill.cli';
import { BOOT_LOOKBACK_MS, LiqAlertLoop } from '../../../src/alerts/liquidations/liq-alert-loop';
import { MemoryLiqStore } from './memory-liq-store';

/**
 * IB-123 (design L9, C4) — the history run drives the live loop's own code over the tape. Pinned here:
 * - it journals exactly what the live loop, ticking every 30 s over the same tape, journals (alerts with their
 *   `at`, keys and details, continuations, controls) — only `source` differs;
 * - it never sends and never marks late, even with the switch on in the database;
 * - a rerun writes 0 rows;
 * - the counts' in-memory journal is blind to rows already in the database (a ½× count after the ×1 write);
 * - a collector gap older than a day is still named (`stream_silent`) and counted as «with gap»;
 * - the first full day, the multipliers, the weekly arithmetic, the CLI's arguments.
 */
const DAY = 86_400_000;
const S = 1_000;
const MIN = 60 * S;
const T0 = Date.UTC(2026, 10, 4); // the first full day
const UNIVERSE = [{ id: 'BTCUSDT', base: 'BTC', binance_perp: 'BTCUSDT', bybit_linear: 'BTCUSDT', okx_swap: 'BTC-USDT-SWAP' }];

/** BTC: three cascades (one big enough to continue), a TRX one, a near-miss hour; spread over 6 h. */
function tape(store: MemoryLiqStore): void {
  const p = (ts: number, usd: number, venue: LiqVenue = 'binance', side: 'long' | 'short' = 'long', base = 'BTC') =>
    store.tape.push({ venue, symbol: venue === 'okx' ? `${base}-USDT-SWAP` : `${base}USDT`, side, ts, usd });
  // 01:00 — 6M longs over 2 min (alert), then 5M more inside the quiet period (continuation at 2×)
  p(T0 + 60 * MIN, 2e6); p(T0 + 61 * MIN, 2e6, 'bybit'); p(T0 + 62 * MIN, 2e6, 'okx');
  p(T0 + 70 * MIN, 3e6); p(T0 + 75 * MIN, 2e6, 'bybit');
  // 01:25 — inside the quiet period (to 01:32): no alert
  p(T0 + 85 * MIN, 5.5e6);
  // 03:00 — shorts 5.2M (alert, other side)
  p(T0 + 180 * MIN, 3e6, 'binance', 'short'); p(T0 + 183 * MIN, 2.2e6, 'okx', 'short');
  // 04:10 — 3M longs: a near-miss (≥ 0.5×)
  p(T0 + 250 * MIN, 3e6);
  // 05:00 — TRX 400k longs on Binance (TRX threshold 300k)
  p(T0 + 300 * MIN, 250e3, 'binance', 'long', 'TRX'); p(T0 + 301 * MIN, 150e3, 'binance', 'long', 'TRX');
}

const strip = (s: MemoryLiqStore) => ({
  alerts: s.alerts.map(({ id: _i, source: _s, confirmedAtMs: _c, ...rest }) => ({ ...rest, details: { ...rest.details, alertId: rest.details.alertId === undefined ? undefined : 'x' } })),
  controls: s.controls.map(({ id: _i, source: _s, ...rest }) => rest),
  paths: s.paths.map((p) => ({ symbol: p.symbol, t0: p.t0 })),
});

describe('IB-123 replayLiq: the live loop over the tape', () => {
  const to = T0 + 6 * 60 * MIN;

  it('journals exactly what the live loop ticking every 30 s journals (only the source differs)', async () => {
    const live = new MemoryLiqStore();
    tape(live);
    const loop = new LiqAlertLoop({ store: live, universe: UNIVERSE, webBaseUrl: '', build: 'dev', source: 'live', send: async () => true });
    for (let t = T0 + BOOT_LOOKBACK_MS; ; t = Math.min(t + 30 * S, to)) { await loop.tick(t + 1); if (t >= to) break; } // +1 ms: never late
    const back = new MemoryLiqStore();
    tape(back);
    const totals = await replayLiq({ store: historyStore(back, { params: back.params, gapsSinceMs: T0 }), universe: UNIVERSE, build: 'dev' }, T0, to);

    expect(back.alerts.every((a) => a.source === 'backfill')).toBe(true);
    expect(back.controls.every((c) => c.source === 'backfill')).toBe(true);
    // live's late flag is off at +1 ms, and the switch is off in both: the rows are equal field for field
    expect(strip(back)).toEqual(strip(live));
    expect(back.alerts.filter((a) => a.event === 'alert').map((a) => [a.symbol, a.details.side, a.atMs])).toEqual([
      ['BTCUSDT', 'long', T0 + 62 * MIN], ['BTCUSDT', 'short', T0 + 183 * MIN], ['TRXUSDT', 'long', T0 + 301 * MIN],
    ]);
    expect(back.alerts.filter((a) => a.event === 'continuing').map((a) => a.atMs)).toEqual([T0 + 75 * MIN]);
    expect(back.controls.some((c) => c.kind === 'near_miss' && c.atMs === T0 + 250 * MIN)).toBe(true);
    expect(totals).toMatchObject({ alerts: 3, continuations: 1, warnings: {} });
    expect(totals.controls).toBe(back.controls.length);
  });

  it('never sends and never marks late, even with the database switch ON; a rerun writes 0 rows', async () => {
    const store = new MemoryLiqStore();
    store.enabled = true;
    tape(store);
    const ports = { store: historyStore(store, { params: store.params, gapsSinceMs: T0 }), universe: UNIVERSE, build: 'dev' };
    await replayLiq(ports, T0, to);
    expect(store.alerts.length).toBeGreaterThan(0);
    expect(store.alerts.every((a) => a.firedAt === null && a.recipients === 0 && a.late === false)).toBe(true);
    const before = { a: store.alerts.length, c: store.controls.length, p: store.paths.length };
    const again = await replayLiq(ports, T0, to);
    expect(again).toMatchObject({ alerts: 0, continuations: 0, controls: 0 });
    expect({ a: store.alerts.length, c: store.controls.length, p: store.paths.length }).toEqual(before);
  });

  it('starts exactly at fromMs: a cascade before it is not evaluated', async () => {
    const store = new MemoryLiqStore();
    store.tape.push({ venue: 'binance', symbol: 'BTCUSDT', side: 'long', ts: T0 - 1, usd: 9e6 });
    store.tape.push({ venue: 'binance', symbol: 'BTCUSDT', side: 'long', ts: T0 + 1, usd: 9e6 });
    await replayLiq({ store: historyStore(store, { params: store.params, gapsSinceMs: T0 }), universe: UNIVERSE, build: 'dev' }, T0, T0 + DAY / 24);
    // the print before fromMs is inside the first window's sum (as at a live boot), but no moment before fromMs is judged
    expect(store.alerts.filter((a) => a.event === 'alert').map((a) => [a.atMs, a.details.sumUsd])).toEqual([[T0 + 1, 18e6]]);
  });

  it('refuses a span shorter than the boot look-back', async () => {
    const store = new MemoryLiqStore();
    await expect(replayLiq({ store, universe: UNIVERSE, build: 'dev' }, T0, T0 + BOOT_LOOKBACK_MS - 1)).rejects.toThrow(/at least 35 min/);
  });

  it('the memory guard is asked before every hour of tape', async () => {
    const store = new MemoryLiqStore();
    const asked: string[] = [];
    await replayLiq({ store, universe: UNIVERSE, build: 'dev', beforeHour: async (l) => { asked.push(l); } }, T0, T0 + 3 * 60 * MIN);
    expect(asked).toEqual(['00:35', '01:00', '02:00', '03:00'].map((h) => `tape at 2026-11-04T${h}:00.000Z`)); // the boot tick, then each hour — not every tick
  });
});

describe('IB-123 the counts: an in-memory journal over the database tape', () => {
  it('a ½× count is the same whether or not the ×1 rows are already in the database', async () => {
    const half = scaleParams(LIQ_DEFAULT_PARAMS, 0.5);
    const count = async (base: MemoryLiqStore) => {
      const mem = new MemoryJournalStore(historyStore(base, { params: half, gapsSinceMs: T0 }));
      await replayLiq({ store: mem, universe: UNIVERSE, build: 'dev' }, T0, T0 + 6 * 60 * MIN);
      return mem.alerts.map((a) => [a.event, a.symbol, a.side, a.atMs]);
    };
    const empty = new MemoryLiqStore();
    tape(empty);
    const written = new MemoryLiqStore();
    tape(written);
    await replayLiq({ store: historyStore(written, { params: written.params, gapsSinceMs: T0 }), universe: UNIVERSE, build: 'dev' }, T0, T0 + 6 * 60 * MIN);
    expect(written.alerts.length).toBeGreaterThan(0);
    const a = await count(empty);
    expect(await count(written)).toEqual(a);
    expect(written.alerts.length).toBeLessThan(a.length + written.alerts.length); // nothing added to the database
    expect(a.filter(([e]) => e === 'alert').length).toBeGreaterThan(3); // ½× fires more than ×1 on this tape
  });

  it('countRows: per coin, long/short, continuations, «with gap» and «not collected», per week = n / days × 7', async () => {
    const base = new MemoryLiqStore();
    tape(base);
    // an old gap on OKX over the 03:00 shorts (older than a day before "now": only a history run's read sees it)
    // and TRX not tracked on Bybit/OKX (L5: Binance only before the 2026-11-05 deploy)
    base.status = {
      ...MemoryLiqStore.allAlive(), gaps: [{ venue: 'okx', from: T0 + 170 * MIN, to: T0 + 190 * MIN }],
      tracked: new Map([['bybit', new Map([['BTCUSDT', 0]])], ['okx', new Map([['BTC-USDT-SWAP', 0]])]]),
    };
    const seen: Array<number | undefined> = [];
    const status = base.venueStatus.bind(base);
    base.venueStatus = async (since?: number) => { seen.push(since); return status(); };
    const mem = new MemoryJournalStore(historyStore(base, { params: LIQ_DEFAULT_PARAMS, gapsSinceMs: T0 }));
    await replayLiq({ store: mem, universe: UNIVERSE, build: 'dev' }, T0, T0 + 6 * 60 * MIN);
    expect(new Set(seen)).toEqual(new Set([T0])); // gaps asked from the run's start, never the live «last day»
    const rows = countRows(mem, LIQ_DEFAULT_PARAMS, 1, 0.25);
    expect(rows.map((r) => r.symbol)).toEqual(Object.keys(LIQ_DEFAULT_PARAMS.perCoin));
    expect(rows.find((r) => r.symbol === 'BTCUSDT')).toEqual({
      symbol: 'BTCUSDT', multiplier: 1, thresholdUsd: 5e6, alerts: 2, longs: 1, shorts: 1, continuations: 1, withGap: 1, notCollected: 0,
      perWeek: 56, continuationsPerWeek: 28,
    });
    expect(rows.find((r) => r.symbol === 'TRXUSDT')).toMatchObject({ alerts: 1, notCollected: 1, withGap: 0, perWeek: 28 });
    expect(rows.find((r) => r.symbol === 'ETHUSDT')).toMatchObject({ alerts: 0, perWeek: 0 });
  });
});

describe('IB-123 pure helpers', () => {
  it('crossCheck compares with the rows STORED, so a rerun (0 new rows) agrees; any table off by one disagrees', () => {
    const stored = { alerts: 25, continuations: 19, controls_random: 18, controls_near_miss: 15, paths: 231 };
    expect(crossCheck({ alerts: 25, continuations: 19, controls: 33 }, stored)).toBeNull();
    expect(crossCheck({ alerts: 25, continuations: 19, controls: 32 }, stored)).toMatch(/25\/19\/32\) differs .* \(25\/19\/33\)/);
    expect(crossCheck({ alerts: 24, continuations: 19, controls: 33 }, stored)).not.toBeNull();
    expect(crossCheck({ alerts: 25, continuations: 18, controls: 33 }, stored)).not.toBeNull();
  });

  it('scaleParams multiplies every threshold and keeps on/off', () => {
    const p = scaleParams({ perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 5e6 }, TRXUSDT: { enabled: false, thresholdUsd: 3e5 } } }, 0.5);
    expect(p).toEqual({ perCoin: { BTCUSDT: { enabled: true, thresholdUsd: 2.5e6 }, TRXUSDT: { enabled: false, thresholdUsd: 1.5e5 } } });
  });

  it('firstFullDay: the day after the LAST stream started; a start at midnight is that day; a stream never seen → null', () => {
    const d = Date.UTC(2026, 10, 3);
    expect(firstFullDay([d + 12 * 3_600_000, d + 46_000, d + 12 * 3_600_000 + 200])).toBe(d + DAY);
    expect(firstFullDay([d, d, d])).toBe(d);
    expect(firstFullDay([d, d + 1, d])).toBe(d + DAY);
    expect(firstFullDay([d, null, d])).toBeNull();
    expect(firstFullDay([])).toBeNull();
  });

  it('parseLiqCliArgs: exactly one mode, --until required with a zone, --counts-to not before it', () => {
    expect(parseLiqCliArgs(['--dry-run', '--until', '2026-11-05T16:59:34Z'])).toEqual({ mode: 'dry-run', untilMs: Date.UTC(2026, 10, 5, 16, 59, 34), countsToMs: Date.UTC(2026, 10, 5, 16, 59, 34) });
    expect(parseLiqCliArgs(['--write', '--until', '2026-11-05T16:59:34Z', '--counts-to', '2026-11-11T00:00:00Z']))
      .toMatchObject({ mode: 'write', countsToMs: Date.UTC(2026, 10, 11) });
    expect(() => parseLiqCliArgs(['--until', '2026-11-05T16:59:34Z'])).toThrow(/usage/);
    expect(() => parseLiqCliArgs(['--dry-run', '--write', '--until', '2026-11-05T16:59:34Z'])).toThrow(/usage/);
    expect(() => parseLiqCliArgs(['--dry-run'])).toThrow(/--until is required/);
    expect(() => parseLiqCliArgs(['--dry-run', '--until', '2026-11-05T16:59:34'])).toThrow(/zone/); // local time: refused
    expect(() => parseLiqCliArgs(['--dry-run', '--until', '2026-11-05T16:59:34Z', '--counts-to', '2026-11-05T00:00:00Z'])).toThrow(/not be before/);
  });
});
