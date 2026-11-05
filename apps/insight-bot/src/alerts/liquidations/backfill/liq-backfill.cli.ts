/**
 * IB-123 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2 L9, §1 C4) — the large-liquidation
 * history run. Standalone: it does NOT boot Nest (no collectors, no second live loop, no Telegram).
 *
 *   node dist/alerts/liquidations/backfill/liq-backfill.cli.js --dry-run --until <ISO> [--counts-to <ISO>]
 *   node dist/alerts/liquidations/backfill/liq-backfill.cli.js --write   --until <ISO> [--counts-to <ISO>]
 *
 * - The tape runs from its **first full UTC day** (every liquidation stream collecting all day).
 * - `--until`: the live loop's first evaluated moment (its boot tick's `from`, logged as
 *   `liq alerts (<from> → <to>]`). The rows written stop there, so live and backfill never cover the same moment.
 *   The run refuses when a live row already lies at or before it.
 * - `--write`: the ×1 replay (L4's defaults) into market_alerts / market_alert_controls with `source='backfill'`
 *   and their paths, committed (idempotent: a rerun writes 0), then every closed path window measured with the
 *   live measurer, paced at ≤ 200 weight a minute. A rerun after the last 72 h window closes measures the rest.
 * - `--dry-run`: the same ×1 replay inside ONE transaction, rolled back: the real SQL, keys and checks. No path
 *   is measured; the weight the write would spend is printed.
 * - Both then print **the counts**: ×½, ×1, ×2 over [first full day, `--counts-to`] (default `--until`), replayed
 *   into an in-memory journal (nothing written), per coin, with a weekly rate. The last line is a JSON summary
 *   (`LIQ_HISTORY_JSON …`) for `checks.py liq-weekly`.
 *
 * Memory, as IB-116 (TL ruling, option A): run with `--max-old-space-size=40 --max-semi-space-size=1
 * --optimize-for-size`; the start gate refuses below 170 MB MemAvailable, the guard pauses below 120 MB before
 * every hour of tape and every 30 s while measuring, and aborts after 5 min low. The box wrapper
 * (`infra/insight-bot/scripts/liq-backfill.sh`) samples every 1 s and kills it below 100 MB.
 *
 * Exit 0 when the run completed, whatever it found (a path window that failed is retried by a rerun and is
 * reported, not an exit); 1 when the run itself broke: a throw, a loop warning, or the ×1 replay disagreeing
 * between the database and memory.
 */
import { LIQ_TICK_SEC } from '@trade-automation/contracts';
import { readFile } from 'node:fs/promises';
import { validateEnv } from '../../../config/env.schema';
import { loadUniverseFile } from '../../../config/universe.loader';
import { PgDatabase } from '../../../db/pg/pg-database';
import type { DbHandle } from '../../../db/db.port';
import { BinanceWeightTracker } from '../../../venues/binance/binance-weight.tracker';
import { CandlesService } from '../../../web/market/candles.service';
import { measureBackfillPaths } from '../../oi-divergence/backfill/history-backfill';
import { MemoryGuard, parseMemAvailableMb } from '../../oi-divergence/backfill/memory-guard';
import { WeightPacer } from '../../oi-divergence/backfill/weight-pacer';
import { PgOiAlertStore } from '../../oi-divergence/pg/oi-alerts.repo';
import { PgLiqBackfillReads } from '../pg/liq-backfill-reads';
import { PgLiqAlertStore } from '../pg/liq-alerts.repo';
import { BOOT_LOOKBACK_MS } from '../liq-alert-loop';
import {
  DAY_MS, LIQ_HISTORY_MULTIPLIERS, LIQ_HISTORY_PARAMS, MemoryJournalStore, countRows, firstFullDay, historyStore, replayLiq,
  scaleParams, crossCheck, type LiqCountRow, type LiqReplayTotals,
} from './liq-history';

/** V31's budget, as IB-116: ≈ 8 % of the IP's 2 400 a minute while it runs. */
export const LIQ_BACKFILL_WEIGHT_PER_MIN = 200;

// eslint-disable-next-line no-console
const say = (line: string): void => console.log(line);
const iso = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString());

class DryRunRollback extends Error {
  constructor(readonly payload: { totals: LiqReplayTotals; counts: Record<string, number>; due: { windows: number; weight: number } }) { super('dry run: rolled back'); }
}

export interface LiqCliArgs { mode: 'dry-run' | 'write'; untilMs: number; countsToMs: number }

/** Pure: argv → the run's arguments; throws a usage line on anything else. */
export function parseLiqCliArgs(argv: readonly string[]): LiqCliArgs {
  const usage = 'usage: liq-backfill.cli.js --dry-run | --write  --until <ISO> [--counts-to <ISO>]';
  const dry = argv.includes('--dry-run');
  const write = argv.includes('--write');
  if (dry === write) throw new Error(usage);
  const value = (flag: string): number | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const t = Date.parse(argv[i + 1] ?? '');
    if (!Number.isFinite(t) || !/Z$|[+-]\d\d:\d\d$/.test(argv[i + 1] ?? '')) throw new Error(`${flag} needs an ISO time with a zone: ${usage}`);
    return t;
  };
  const untilMs = value('--until');
  if (untilMs === null) throw new Error(`--until is required (the live loop's first evaluated moment): ${usage}`);
  const countsToMs = value('--counts-to') ?? untilMs;
  if (countsToMs < untilMs) throw new Error('--counts-to must not be before --until');
  return { mode: dry ? 'dry-run' : 'write', untilMs, countsToMs };
}

/** `now` is the run's one clock (IB-051: threaded, not read twice); production passes nothing. */
async function main(argv: string[], now: () => number = Date.now): Promise<number> {
  const args = parseLiqCliArgs(argv);
  const env = validateEnv(process.env as Record<string, unknown>);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const universe = loadUniverseFile(env.UNIVERSE_FILE).symbols;
  const db = new PgDatabase(env.DATABASE_URL);
  const guard = new MemoryGuard({
    availableMb: async () => readFile('/proc/meminfo', 'utf8').then(parseMemAvailableMb, () => null),
    now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: say,
  });
  const started = now();
  let exit = 0;
  try {
    const reads = new PgLiqBackfillReads(db);
    const starts = await reads.streamStarts();
    const fromMs = firstFullDay(starts);
    say(`liq backfill ${args.mode}: build ${env.BUILD_SHA}; streams first seen ${starts.map(iso).join(', ')}`);
    if (fromMs === null) throw new Error('a liquidation stream has never been seen: no tape to replay');
    if (args.untilMs - fromMs < BOOT_LOOKBACK_MS) throw new Error(`--until ${iso(args.untilMs)} leaves less than ${BOOT_LOOKBACK_MS / 60_000} min after the first full day ${iso(fromMs)}`);
    if (args.countsToMs > now()) throw new Error(`--counts-to ${iso(args.countsToMs)} is in the future`);
    const live = await reads.liveRowsUpTo(args.untilMs);
    if (live > 0) throw new Error(`${live} live liquidation row(s) lie at or before --until ${iso(args.untilMs)}: the live loop started earlier; pass its first evaluated moment`);
    say(`write range (${iso(fromMs)}, ${iso(args.untilMs)}] at ×1 (L4 defaults); counts range (${iso(fromMs)}, ${iso(args.countsToMs)}] at ×${LIQ_HISTORY_MULTIPLIERS.join(', ×')}; tick ${LIQ_TICK_SEC} s as live`);

    const replay = (handle: DbHandle, params = LIQ_HISTORY_PARAMS, to = args.untilMs, wrap?: (s: ReturnType<typeof historyStore>) => ReturnType<typeof historyStore>) => {
      const base = historyStore(new PgLiqAlertStore(handle), { params, gapsSinceMs: fromMs });
      return replayLiq({ store: wrap ? wrap(base) : base, universe, build: env.BUILD_SHA, log: say, beforeHour: (l) => guard.check(l) }, fromMs, to);
    };

    // 1. the ×1 rows
    await guard.gate('the replay');
    let totals: LiqReplayTotals;
    let counts: Record<string, number>;
    let due = { windows: 0, weight: 0 };
    if (args.mode === 'dry-run') {
      try {
        await db.transaction(async (tx) => {
          const t = await replay(tx);
          const r = new PgLiqBackfillReads(tx);
          throw new DryRunRollback({ totals: t, counts: await r.backfillCounts(), due: await r.pathsDueNow(now()) });
        });
        throw new Error('unreachable');
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        ({ totals, counts, due } = error.payload);
      }
    } else {
      totals = await replay(db);
      counts = await reads.backfillCounts();
    }
    printTotals(totals, counts, args.mode);
    if (Object.keys(totals.warnings).length > 0) exit = 1;

    // 2. paths (write only)
    if (args.mode === 'dry-run') {
      say(`dry run: rolled back, nothing written. Writing now would measure ${due.windows} closed windows: ${due.weight} weight ≈ ${Math.ceil(due.weight / LIQ_BACKFILL_WEIGHT_PER_MIN)} min at ${LIQ_BACKFILL_WEIGHT_PER_MIN}/min`);
    } else {
      await guard.gate('path measuring');
      const weight = new BinanceWeightTracker();
      const candles = new CandlesService({ futuresBaseUrl: env.BINANCE_FUTURES_REST_BASE_URL, spotBaseUrl: env.BINANCE_SPOT_REST_BASE_URL, weight });
      const pacer = new WeightPacer(LIQ_BACKFILL_WEIGHT_PER_MIN, now);
      const paths = await measureBackfillPaths(
        { store: new PgOiAlertStore(db), build: env.BUILD_SHA, log: say, klines5m: async (symbol, from, limit) => candles.closedKlines(symbol, '5m', from * 1000, limit) },
        { take: async (w) => { await guard.every30s('path measuring'); await pacer.take(w); } }, now, 50, 'market',
      );
      const left = await reads.unmeasuredPaths();
      say(`paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}, ${paths.durationSec} s; left ${left.count}`
        + (left.lastCloses ? ` (the last window closes ${iso(left.lastCloses)}; a rerun after it measures them)` : ''));
    }

    // 3. the counts, in memory
    const days = (args.countsToMs - fromMs) / DAY_MS;
    const table: LiqCountRow[] = [];
    for (const k of LIQ_HISTORY_MULTIPLIERS) {
      let mem: MemoryJournalStore | null = null;
      const t = await replay(db, scaleParams(LIQ_HISTORY_PARAMS, k), args.countsToMs, (s) => (mem = new MemoryJournalStore(s)));
      if (Object.keys(t.warnings).length > 0) exit = 1;
      table.push(...countRows(mem as unknown as MemoryJournalStore, scaleParams(LIQ_HISTORY_PARAMS, k), k, days));
      say(`counts ×${k}: ${t.ticks} ticks, ${t.alerts} alerts, ${t.continuations} continuations, ${t.controls} controls, ${t.reads} reads`);
      // same range only: a longer counts range (the weekly rerun) holds days the write never covers
      const mismatch = k === 1 && args.countsToMs === args.untilMs ? crossCheck(t, counts) : null;
      if (mismatch) { say(`MISMATCH: ${mismatch}`); exit = 1; }
    }
    printTable(table, fromMs, args.countsToMs, days);
    say(`LIQ_HISTORY_JSON ${JSON.stringify({ mode: args.mode, from: iso(fromMs), until: iso(args.untilMs), countsTo: iso(args.countsToMs), days: Math.round(days * 1000) / 1000, written: counts, table })}`);
  } finally {
    say(`done in ${Math.round((now() - started) / 1000)} s; lowest MemAvailable seen by the guard: ${guard.minSeenMb ?? 'unreadable'} MB`);
    await db.end();
  }
  return exit;
}

function printTotals(t: LiqReplayTotals, counts: Record<string, number>, mode: string): void {
  say(`${mode} ×1: ${t.ticks} ticks over (${iso(t.fromMs)}, ${iso(t.toMs)}]; new rows: alerts ${t.alerts}, continuations ${t.continuations}, controls ${t.controls}; ${t.reads} reads, at most ${t.maxPrints} prints held`);
  say(`rows with source = backfill now: ${JSON.stringify(counts)}`);
  for (const [m, n] of Object.entries(t.warnings)) say(`  WARNING ×${n}: ${m}`);
}

function printTable(rows: readonly LiqCountRow[], fromMs: number, toMs: number, days: number): void {
  say(`counts over (${iso(fromMs)}, ${iso(toMs)}] = ${days.toFixed(2)} days; per week = count / days × 7`);
  say('coin      ×    threshold   alerts (long/short)  /week  continuations  /week  with-gap  not-collected');
  for (const r of rows) {
    say(`${r.symbol.padEnd(9)} ${String(r.multiplier).padEnd(4)} ${String(r.thresholdUsd).padStart(9)}   ${String(r.alerts).padStart(4)} (${r.longs}/${r.shorts})`.padEnd(51)
      + `${String(r.perWeek).padStart(6)}  ${String(r.continuations).padStart(13)}  ${String(r.continuationsPerWeek).padStart(5)}  ${String(r.withGap).padStart(8)}  ${String(r.notCollected).padStart(13)}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    // eslint-disable-next-line no-console
    console.error(`liq backfill failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
