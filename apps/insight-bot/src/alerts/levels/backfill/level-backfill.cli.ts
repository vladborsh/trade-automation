/**
 * IB-127 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4 P8, §1 C4) — the level history run.
 * Standalone: it does NOT boot Nest (no collectors, no second live loop, no Telegram).
 *
 *   node dist/alerts/levels/backfill/level-backfill.cli.js --dry-run --until <ISO>
 *   node dist/alerts/levels/backfill/level-backfill.cli.js --write   --until <ISO>
 *
 * - `--until`: the 15m close in the live level loop's FIRST heartbeat (`level alerts @<ISO>: …`), on the 15m grid.
 *   The live loop evaluated the bar closing then first, so the replay evaluates every bar that opened in the
 *   LEVEL_HISTORY_DAYS (90) before that bar's open: live and backfill never evaluate the same bar. The run refuses
 *   when a live level row lies before that bar.
 * - Klines from Binance, per enabled `alert_symbols` coin: 15m from the month start before the replay (P10's seed
 *   reads from there) to `--until`, in pages of 1 500 (weight 10; ≈ 9 pages a coin), and 1d from 70 days before
 *   the replay (one call of weight 2), paced with the path measuring at ≤ 200 weight a minute. Held in memory
 *   (≈ 11 500 bars a coin), never stored (S1).
 * - `--write`: the ×1 replay (the shipped defaults: PDH/PDL off) into market_alerts / market_alert_controls with
 *   `source='backfill'` and their paths, committed (idempotent: a rerun writes 0), then every closed path window
 *   measured with the live measurer, `level` subjects only. A rerun after the last 72 h window closes measures the
 *   rest.
 * - `--dry-run`: the same ×1 replay inside ONE transaction, rolled back. No path is measured; the weight the write
 *   would spend is printed.
 * - Both then print **the counts**: one replay with PDH/PDL on for every coin at the touch band ×½, ×1 and ×2, into
 *   memory: alerts per coin, level kind and event with a weekly rate (the events have no threshold), touches per coin
 *   per day at each band. The ×1 count without PDH/PDL is cross-checked against the backfill rows stored. Last line:
 *   `LEVEL_HISTORY_JSON {…}`.
 *
 * IB-151 — `--muted-gap <ISO>` (with `--dry-run` or `--write` and `--until`): the rows the live loop SKIPPED before
 * IB-151 because a switch was off, from the switch time `<ISO>` (the owner's 2026-11-06 enable with the weekly open
 * off: 13:06:05Z) to the deploy's first heartbeat close `--until`. The replay is this run's, from the first bar
 * evaluated after the switch (`firstBarDecidedAfter`), with the LIVE settings read once at the start (WO off, PDH/PDL
 * off, …) instead of the shipped defaults; `mutedGapStore` writes only the muted alerts (`source = 'backfill'`,
 * `muted_by` set) whose once-key live has not journalled, with their paths; no controls. The 90-day counts are not run,
 * and the «a live row before --until» refusal does not apply (live rows fill the window: that is the point).
 * Venue weight: 15m from the month start before `<ISO>` (≤ 2 pages of weight 10 a coin) and 1d (weight 2) a coin.
 *
 * Memory, as IB-116/IB-123/IB-125: run with `--max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size`;
 * the start gate (MEM_START_FLOOR_MB, default 170) refuses, the guard pauses below 120 MB before every replayed day
 * and every 30 s while measuring. The box wrapper (`infra/insight-bot/scripts/level-backfill.sh`) kills it below
 * 100 MB.
 *
 * Exit 0 when the run completed, whatever it found; 1 when the run itself broke: a throw, a loop warning or failed
 * coin, or the ×1 replay disagreeing between the database and memory.
 */
import { readFile } from 'node:fs/promises';
import { LEVEL_DAILY_BARS, LEVEL_DAILY_KINDS, type LevelBar, type WebCandle } from '@trade-automation/contracts';
import { validateEnv } from '../../../config/env.schema';
import { PgDatabase } from '../../../db/pg/pg-database';
import { savepointDb } from '../../../db/pg/savepoint-db';
import { BinanceWeightTracker } from '../../../venues/binance/binance-weight.tracker';
import { CandlesService } from '../../../web/market/candles.service';
import { PgLevelBackfillReads } from '../../liquidations/pg/market-backfill-reads';
import { measureBackfillPaths } from '../../oi-divergence/backfill/history-backfill';
import { MemoryGuard, parseMemAvailableMb, startFloorFromEnv } from '../../oi-divergence/backfill/memory-guard';
import { WeightPacer } from '../../oi-divergence/backfill/weight-pacer';
import { PgOiAlertStore } from '../../oi-divergence/pg/oi-alerts.repo';
import { PgLevelAlertStore, type LevelAlertStore } from '../pg/level-alerts.repo';
import {
  BAR_MS, DAY_MS, HistoryLevelVenue, firstBarDecidedAfter, mutedGapStore, LEVEL_HISTORY_BAND_MULTIPLIERS, LEVEL_HISTORY_DAYS, MemoryLevelJournal, fetchClosed, levelCountRows,
  levelCrossCheck, levelHistoryParams, levelHistoryStore, levelShippedCounts, levelTouchRows, replayLevels, seedFrom, toLevelBar,
  type CountedLevelAlert, type LevelCountRow, type LevelReplayTotals, type LevelTouchRow,
} from './level-history';

/** V31's budget, as IB-116/IB-123/IB-125: ≈ 8 % of the IP's 2 400 a minute while it runs. */
export const LEVEL_BACKFILL_WEIGHT_PER_MIN = 200;

// eslint-disable-next-line no-console
const say = (line: string): void => console.log(line);
const iso = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString());

class DryRunRollback extends Error {
  constructor(readonly payload: { totals: LevelReplayTotals; counts: Record<string, number>; due: { windows: number; weight: number } }) { super('dry run: rolled back'); }
}

export interface LevelCliArgs {
  mode: 'dry-run' | 'write';
  untilMs: number;
  /** IB-151: the switch time the muted-gap run starts from; absent = the IB-127 90-day run. */
  gapFromMs?: number;
}

/** Pure: argv → the run's arguments; throws a usage line on anything else. */
export function parseLevelCliArgs(argv: readonly string[]): LevelCliArgs {
  const usage = 'usage: level-backfill.cli.js --dry-run | --write  --until <ISO>  [--muted-gap <ISO>]';
  const dry = argv.includes('--dry-run');
  const write = argv.includes('--write');
  if (dry === write) throw new Error(usage);
  const i = argv.indexOf('--until');
  const raw = i < 0 ? undefined : argv[i + 1];
  if (raw === undefined) throw new Error(`--until is required (the 15m close in the live level loop's first heartbeat): ${usage}`);
  const untilMs = Date.parse(raw);
  if (!Number.isFinite(untilMs) || !/Z$|[+-]\d\d:\d\d$/.test(raw)) throw new Error(`--until needs an ISO time with a zone: ${usage}`);
  if (untilMs % BAR_MS !== 0) throw new Error(`--until ${raw} is not a 15m close (the heartbeat line's time is): ${usage}`);
  const g = argv.indexOf('--muted-gap');
  if (g < 0) return { mode: dry ? 'dry-run' : 'write', untilMs };
  const gapRaw = argv[g + 1];
  const gapFromMs = gapRaw === undefined ? NaN : Date.parse(gapRaw);
  if (gapRaw === undefined || !Number.isFinite(gapFromMs) || !/Z$|[+-]\d\d:\d\d$/.test(gapRaw)) throw new Error(`--muted-gap needs the switch time, ISO with a zone: ${usage}`);
  if (firstBarDecidedAfter(gapFromMs) >= untilMs - BAR_MS) throw new Error(`--muted-gap ${gapRaw} leaves no bar before --until ${raw}: ${usage}`);
  return { mode: dry ? 'dry-run' : 'write', untilMs, gapFromMs };
}

/** The replay's bar opens, [from, to): the 90 days before the bar the live loop evaluated first. */
export function levelReplayRange(untilMs: number): { fromMs: number; toMs: number } {
  const toMs = untilMs - BAR_MS;
  return { fromMs: toMs - LEVEL_HISTORY_DAYS * DAY_MS, toMs };
}

/** `now` is the run's one clock (IB-051: threaded, not read twice); production passes nothing. */
async function main(argv: string[], now: () => number = Date.now): Promise<number> {
  const args = parseLevelCliArgs(argv);
  const env = validateEnv(process.env as Record<string, unknown>);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new PgDatabase(env.DATABASE_URL);
  const guard = new MemoryGuard({
    availableMb: async () => readFile('/proc/meminfo', 'utf8').then(parseMemAvailableMb, () => null),
    now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: say,
    startFloorMb: startFloorFromEnv(process.env.MEM_START_FLOOR_MB),
  });
  const started = now();
  let exit = 0;
  try {
    if (args.untilMs > now()) throw new Error(`--until ${iso(args.untilMs)} is in the future`);
    if (args.gapFromMs !== undefined) return await mutedGap(args as Required<LevelCliArgs>, db, env, guard, now);
    const { fromMs, toMs } = levelReplayRange(args.untilMs);
    const reads = new PgLevelBackfillReads(db);
    const live = await reads.liveRowsUpTo(toMs - 1);
    if (live > 0) throw new Error(`${live} live level row(s) lie before the bar ${iso(toMs)} (--until ${iso(args.untilMs)}): the live loop started earlier; pass its first heartbeat`);
    const coins = await new PgLevelAlertStore(db).listedCoins();
    if (coins.length === 0) throw new Error('no enabled alert_symbols coin');
    const symbols = coins.map((c) => c.symbol);
    await guard.gate('the replay');

    // 1. klines from the venue, paced (the same pacer as the paths)
    const weight = new BinanceWeightTracker();
    const pacer = new WeightPacer(LEVEL_BACKFILL_WEIGHT_PER_MIN, now);
    const candles = new CandlesService({ futuresBaseUrl: env.BINANCE_FUTURES_REST_BASE_URL, spotBaseUrl: env.BINANCE_SPOT_REST_BASE_URL, weight });
    const bars = new Map<string, LevelBar[]>();
    const daily = new Map<string, WebCandle[]>();
    let calls = 0;
    let venueWeight = 0;
    const take = (w: number) => pacer.take(w);
    for (const symbol of symbols) {
      const m = await fetchClosed((s, l) => candles.closedKlines(symbol, '15m', s, l), BAR_MS, seedFrom(fromMs), args.untilMs, take);
      const d = await fetchClosed((s, l) => candles.closedKlines(symbol, '1d', s, l), DAY_MS, fromMs - LEVEL_DAILY_BARS * DAY_MS, args.untilMs, take);
      calls += m.calls + d.calls;
      venueWeight += m.weight + d.weight;
      bars.set(symbol, m.candles.map(toLevelBar));
      daily.set(symbol, d.candles);
      const expected = (args.untilMs - seedFrom(fromMs)) / BAR_MS;
      say(`klines ${symbol}: 15m ${m.candles.length} of ${expected} bars ${iso((m.candles[0]?.time ?? NaN) * 1000)} … ${iso((m.candles.at(-1)?.time ?? NaN) * 1000)} (${m.calls} calls, weight ${m.weight}); `
        + `1d ${d.candles.length} (${d.calls} call, weight ${d.weight})`);
    }
    say(`level backfill ${args.mode}: build ${env.BUILD_SHA}; ${symbols.length} coins (${symbols.join(', ')}); venue calls ${calls}, weight ${venueWeight}`);
    say(`replay bars [${iso(fromMs)}, ${iso(toMs)}) = ${LEVEL_HISTORY_DAYS} days, a tick every minute as live; P10 state seeded and rolled as live, from no rows`);

    const replay = (base: LevelAlertStore, k: number, withDaily: boolean) => replayLevels({
      store: levelHistoryStore(base, { params: levelHistoryParams(symbols, k, withDaily), coins }),
      venue: new HistoryLevelVenue(bars, daily), build: env.BUILD_SHA, log: say, beforeDay: (l) => guard.check(l),
    }, fromMs, toMs);
    const broke = (t: LevelReplayTotals): boolean => Object.keys(t.warnings).length > 0 || t.failed > 0;

    // 2. the ×1 rows (shipped defaults)
    let totals: LevelReplayTotals;
    let counts: Record<string, number>;
    let due = { windows: 0, weight: 0 };
    if (args.mode === 'dry-run') {
      try {
        await db.transaction(async (tx) => {
          const t = await replay(new PgLevelAlertStore(savepointDb(tx)), 1, false);
          const r = new PgLevelBackfillReads(tx);
          throw new DryRunRollback({ totals: t, counts: await r.backfillCounts(), due: await r.pathsDueNow(now()) });
        });
        throw new Error('unreachable');
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        ({ totals, counts, due } = error.payload);
      }
    } else {
      totals = await replay(new PgLevelAlertStore(db), 1, false);
      counts = await reads.backfillCounts();
    }
    say(`${args.mode} ×1: ${totals.ticks} ticks, ${totals.bars} coin-bars, ${totals.seeds} seeds; new rows: alerts ${totals.alerts}, controls ${totals.controls}; failed ${totals.failed}`);
    say(`rows with type = level, source = backfill now: ${JSON.stringify(counts)}`);
    for (const [m, n] of Object.entries(totals.warnings)) say(`  WARNING ×${n}: ${m}`);
    if (broke(totals)) exit = 1;

    // 3. paths (write only)
    if (args.mode === 'dry-run') {
      say(`dry run: rolled back, nothing written. Writing now would measure ${due.windows} closed windows: ${due.weight} weight ≈ ${Math.ceil(due.weight / LEVEL_BACKFILL_WEIGHT_PER_MIN)} min at ${LEVEL_BACKFILL_WEIGHT_PER_MIN}/min`);
    } else {
      await guard.gate('path measuring');
      const paths = await measureBackfillPaths(
        { store: new PgOiAlertStore(db), build: env.BUILD_SHA, log: say, klines5m: async (symbol, from, limit) => candles.closedKlines(symbol, '5m', from * 1000, limit) },
        { take: async (w) => { await guard.every30s('path measuring'); await pacer.take(w); } }, now, 50, 'level',
      );
      const left = await reads.unmeasuredPaths();
      say(`paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}, ${paths.durationSec} s; left ${left.count}`
        + (left.lastCloses ? ` (the last window closes ${iso(left.lastCloses)}; a rerun after it measures them)` : ''));
    }

    // 4. the counts, in memory: PDH/PDL on for every coin, the touch band ×½ / ×1 / ×2
    const days = (toMs - fromMs) / DAY_MS;
    let table: LevelCountRow[] = [];
    const touches: LevelTouchRow[] = [];
    let alerts: CountedLevelAlert[] = [];
    for (const k of LEVEL_HISTORY_BAND_MULTIPLIERS) {
      const j = new MemoryLevelJournal();
      const t = await replay(j, k, true);
      if (broke(t)) exit = 1;
      touches.push(...levelTouchRows(j, symbols, k, days));
      say(`counts band ×${k}: alerts ${j.alerts.length} (PDH/PDL ${j.alerts.filter((a) => LEVEL_DAILY_KINDS.includes(a.kind)).length}), `
        + `touches ${j.controls.filter((c) => c.kind === 'touch').length}, random ${j.controls.filter((c) => c.kind === 'random').length}`);
      if (k === 1) {
        const mismatch = levelCrossCheck(j, counts);
        if (mismatch) { say(`MISMATCH: ${mismatch}`); exit = 1; }
        say(`×1 without PDH/PDL (what the rows hold): ${JSON.stringify(levelShippedCounts(j))}`);
        table = levelCountRows(j, symbols, days);
        alerts = j.alerts;
      }
    }
    printTable(table, touches, fromMs, toMs, days);
    printAlerts(alerts);
    say(`LEVEL_HISTORY_JSON ${JSON.stringify({
      mode: args.mode, from: iso(fromMs), to: iso(toMs), until: iso(args.untilMs), days, venueCalls: calls, venueWeight, written: counts, table, touches,
      alerts: alerts.map((a) => ({ event: a.event, symbol: a.symbol, kind: a.kind, price: a.price, at: iso(a.atMs), bar: a.details.bar, prevClose: a.details.prevClose, firstBeyondAt: iso((a.details.firstBeyondAtMs as number | null) ?? null) })),
    })}`);
  } finally {
    say(`done in ${Math.round((now() - started) / 1000)} s; lowest MemAvailable seen by the guard: ${guard.minSeenMb ?? 'unreadable'} MB`);
    await db.end();
  }
  return exit;
}

/** IB-151's gap run (see the module comment). Exit 0 when it completed, 1 when the replay broke. */
async function mutedGap(
  args: Required<LevelCliArgs>, db: PgDatabase, env: ReturnType<typeof validateEnv>, guard: MemoryGuard, now: () => number,
): Promise<number> {
  const fromMs = firstBarDecidedAfter(args.gapFromMs);
  const toMs = args.untilMs - BAR_MS;
  const live = new PgLevelAlertStore(db);
  const settings = await live.settings();
  const coins = await live.listedCoins();
  if (coins.length === 0) throw new Error('no enabled alert_symbols coin');
  await guard.gate('the gap replay');
  const weight = new BinanceWeightTracker();
  const pacer = new WeightPacer(LEVEL_BACKFILL_WEIGHT_PER_MIN, now);
  const candles = new CandlesService({ futuresBaseUrl: env.BINANCE_FUTURES_REST_BASE_URL, spotBaseUrl: env.BINANCE_SPOT_REST_BASE_URL, weight });
  const bars = new Map<string, LevelBar[]>();
  const daily = new Map<string, WebCandle[]>();
  let venueWeight = 0;
  for (const { symbol } of coins) {
    const m = await fetchClosed((s, l) => candles.closedKlines(symbol, '15m', s, l), BAR_MS, seedFrom(fromMs), args.untilMs, (w) => pacer.take(w));
    const d = await fetchClosed((s, l) => candles.closedKlines(symbol, '1d', s, l), DAY_MS, fromMs - LEVEL_DAILY_BARS * DAY_MS, args.untilMs, (w) => pacer.take(w));
    venueWeight += m.weight + d.weight;
    bars.set(symbol, m.candles.map(toLevelBar));
    daily.set(symbol, d.candles);
  }
  say(`level muted-gap ${args.mode}: build ${env.BUILD_SHA}; switch ${iso(args.gapFromMs)} → bars [${iso(fromMs)}, ${iso(toMs)}); ${coins.length} coins; venue weight ${venueWeight}`);
  say(`live settings, frozen for the run: ${JSON.stringify(settings.params)}`);
  const reads = new PgLevelBackfillReads(db);
  const replay = async (base: PgLevelAlertStore, r: PgLevelBackfillReads) => {
    const store = mutedGapStore(base, (keys) => r.liveKeys(keys));
    const totals = await replayLevels({
      store: levelHistoryStore(store, { params: settings.params, coins }), venue: new HistoryLevelVenue(bars, daily), build: env.BUILD_SHA, log: say,
      beforeDay: (l) => guard.check(l),
    }, fromMs, toMs);
    return { totals, unmuted: store.unmuted, inLive: store.inLive };
  };
  let out: Awaited<ReturnType<typeof replay>>;
  let counts: Record<string, number>;
  if (args.mode === 'dry-run') {
    try {
      await db.transaction(async (tx) => {
        const r = new PgLevelBackfillReads(tx);
        const x = await replay(new PgLevelAlertStore(savepointDb(tx)), r);
        throw new GapRollback(x, await r.backfillCounts());
      });
      throw new Error('unreachable');
    } catch (error) {
      if (!(error instanceof GapRollback)) throw error;
      ({ out, counts } = error);
    }
  } else {
    out = await replay(new PgLevelAlertStore(db), reads);
    counts = await reads.backfillCounts();
  }
  const { totals } = out;
  say(`${args.mode} muted-gap: ${totals.ticks} ticks, ${totals.bars} coin-bars, ${totals.seeds} seeds; muted rows written ${totals.alerts}; `
    + `skipped: unmuted ${out.unmuted} (live journalled those), already in live ${out.inLive}; failed ${totals.failed}`);
  say(`rows with type = level, source = backfill now: ${JSON.stringify(counts)}`);
  for (const [m, n] of Object.entries(totals.warnings)) say(`  WARNING ×${n}: ${m}`);
  if (args.mode === 'write') {
    await guard.gate('path measuring');
    const paths = await measureBackfillPaths(
      { store: new PgOiAlertStore(db), build: env.BUILD_SHA, log: say, klines5m: async (symbol, from, limit) => candles.closedKlines(symbol, '5m', from * 1000, limit) },
      { take: async (w) => { await guard.every30s('path measuring'); await pacer.take(w); } }, now, 50, 'level',
    );
    const left = await reads.unmeasuredPaths();
    say(`paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}; left ${left.count}`
      + (left.lastCloses ? ` (the last window closes ${iso(left.lastCloses)}; a rerun after it measures them)` : ''));
  }
  say(`LEVEL_MUTED_GAP_JSON ${JSON.stringify({ mode: args.mode, switchAt: iso(args.gapFromMs), from: iso(fromMs), to: iso(toMs), venueWeight, written: totals.alerts, unmuted: out.unmuted, inLive: out.inLive, counts })}`);
  return Object.keys(totals.warnings).length > 0 || totals.failed > 0 ? 1 : 0;
}

class GapRollback extends Error {
  constructor(readonly out: { totals: LevelReplayTotals; unmuted: number; inLive: number }, readonly counts: Record<string, number>) { super('dry run: rolled back'); }
}

function printTable(rows: readonly LevelCountRow[], touches: readonly LevelTouchRow[], fromMs: number, toMs: number, days: number): void {
  say(`counts over bars [${iso(fromMs)}, ${iso(toMs)}) = ${days.toFixed(2)} days; per week = count / days × 7; PDH/PDL on for every coin (off by default)`);
  say('coin      kind  event           count   /week');
  for (const r of rows) say(`${r.symbol.padEnd(9)} ${r.kind.padEnd(5)} ${r.event.padEnd(14)} ${String(r.count).padStart(6)}  ${String(r.perWeek).padStart(6)}`);
  say('touches (controls, never sent): coin  band  count  /day  by kind');
  for (const t of touches) {
    say(`  ${t.symbol.padEnd(9)} ${(t.touchBand * 100).toFixed(3)} %  ${String(t.touches).padStart(5)}  ${String(t.perDay).padStart(5)}  ${JSON.stringify(t.byKind)}`);
  }
}

/** The ×1 alerts, one line each, for the owner report's examples. */
function printAlerts(alerts: readonly CountedLevelAlert[]): void {
  say('alerts ×1: event          coin       kind  level        at (UTC, bar open)  high / low / close  prev close  first beyond');
  for (const a of [...alerts].sort((x, y) => x.atMs - y.atMs)) {
    const b = a.details.bar as LevelBar;
    say(`  ${a.event.padEnd(14)} ${a.symbol.padEnd(10)} ${a.kind.padEnd(5)} ${String(a.price).padEnd(12)} ${iso(a.atMs).slice(0, 16)}  ${b.high} / ${b.low} / ${b.close}  ${a.details.prevClose}  `
      + `${a.details.firstBeyondAtMs ? iso(a.details.firstBeyondAtMs as number).slice(0, 16) : ''}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    // eslint-disable-next-line no-console
    console.error(`level backfill failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
