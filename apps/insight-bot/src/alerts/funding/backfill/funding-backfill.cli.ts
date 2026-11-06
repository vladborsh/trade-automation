/**
 * IB-125 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3 F9, §1 C4) — the funding history run.
 * Standalone: it does NOT boot Nest (no collectors, no second live loop, no Telegram).
 *
 *   node dist/alerts/funding/backfill/funding-backfill.cli.js --dry-run --until <ISO>
 *   node dist/alerts/funding/backfill/funding-backfill.cli.js --write   --until <ISO>
 *
 * - `--until`: the live funding loop's first check (its first `funding alerts @<ISO>` log line). The replay covers
 *   the FUNDING_HISTORY_DAYS (180) before it, so live and backfill never cover the same moment; the run refuses
 *   when a live funding row lies at or before it. When a coin's last settlement is before `--until`, the replay
 *   ends there (`replayEnd`): a check needs the settlement that ends its interval.
 * - Settled funding comes from Binance: per enabled `alert_symbols` coin, `/fapi/v1/fundingRate` over the 180 days
 *   plus the 30-day sample before them (one call of weight 1 per 1 000 settlements: 5 for five 8 h coins), paced
 *   with the path measuring at ≤ 200 weight a minute. Held in memory (≈ 630 points a coin), never stored (S1).
 * - `--write`: the ×1 replay (the shipped defaults) into market_alerts / market_alert_controls with
 *   `source='backfill'` and their paths, committed (idempotent: a rerun writes 0), then every closed path window
 *   measured with the live measurer, `funding` subjects only. A rerun after the last 72 h window closes
 *   measures the rest.
 * - `--dry-run`: the same ×1 replay inside ONE transaction, rolled back. No path is measured; the weight the
 *   write would spend is printed.
 * - Both then print **the counts**: ×½, ×1, ×2 of the floor, replayed into memory, per coin with a weekly rate;
 *   the ×1 count is cross-checked against the backfill rows stored. Last line: `FUNDING_HISTORY_JSON {…}`.
 *
 * Memory, as IB-116/IB-123: run with `--max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size`; the
 * start gate (MEM_START_FLOOR_MB, default 170) refuses, the guard pauses below 120 MB before every replayed day and
 * every 30 s while measuring. The box wrapper (`infra/insight-bot/funding-backfill.sh`) kills it below 100 MB.
 *
 * Exit 0 when the run completed, whatever it found; 1 when the run itself broke: a throw, a loop warning, or the
 * ×1 replay disagreeing between the database and memory.
 */
import { readFile } from 'node:fs/promises';
import { validateEnv } from '../../../config/env.schema';
import { PgDatabase } from '../../../db/pg/pg-database';
import { savepointDb } from '../../../db/pg/savepoint-db';
import { POSITIONING_BASELINE_DAYS } from '../../../insights/thresholds';
import { BinanceWeightTracker } from '../../../venues/binance/binance-weight.tracker';
import { FUNDING_RANGE_LIMIT, PerpRest } from '../../../venues/binance/perp.rest';
import { CandlesService } from '../../../web/market/candles.service';
import { FUNDING_CALL_WEIGHT } from '../../../web/market/funding.service';
import { PgFundingBackfillReads } from '../../liquidations/pg/market-backfill-reads';
import { measureBackfillPaths } from '../../oi-divergence/backfill/history-backfill';
import { MemoryGuard, parseMemAvailableMb, startFloorFromEnv } from '../../oi-divergence/backfill/memory-guard';
import { WeightPacer } from '../../oi-divergence/backfill/weight-pacer';
import { PgOiAlertStore } from '../../oi-divergence/pg/oi-alerts.repo';
import { PgFundingAlertStore, type FundingAlertStore } from '../pg/funding-alerts.repo';
import {
  DAY_MS, FUNDING_HISTORY_DAYS, FUNDING_HISTORY_MULTIPLIERS, HistoryFundingVenue, MemoryFundingJournal, fetchSettled, fundingCountRows,
  fundingCrossCheck, fundingHistoryParams, fundingHistoryStore, replayEnd, replayFunding,
  type CountedFundingAlert, type FundingCountRow, type FundingReplayTotals, type SettledPoint,
} from './funding-history';

/** V31's budget, as IB-116/IB-123: ≈ 8 % of the IP's 2 400 a minute while it runs. */
export const FUNDING_BACKFILL_WEIGHT_PER_MIN = 200;

// eslint-disable-next-line no-console
const say = (line: string): void => console.log(line);
const iso = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString());

class DryRunRollback extends Error {
  constructor(readonly payload: { totals: FundingReplayTotals; counts: Record<string, number>; due: { windows: number; weight: number } }) { super('dry run: rolled back'); }
}

export interface FundingCliArgs { mode: 'dry-run' | 'write'; untilMs: number }

/** Pure: argv → the run's arguments; throws a usage line on anything else. */
export function parseFundingCliArgs(argv: readonly string[]): FundingCliArgs {
  const usage = 'usage: funding-backfill.cli.js --dry-run | --write  --until <ISO>';
  const dry = argv.includes('--dry-run');
  const write = argv.includes('--write');
  if (dry === write) throw new Error(usage);
  const i = argv.indexOf('--until');
  const raw = i < 0 ? undefined : argv[i + 1];
  if (raw === undefined) throw new Error(`--until is required (the live funding loop's first check): ${usage}`);
  const untilMs = Date.parse(raw);
  if (!Number.isFinite(untilMs) || !/Z$|[+-]\d\d:\d\d$/.test(raw)) throw new Error(`--until needs an ISO time with a zone: ${usage}`);
  return { mode: dry ? 'dry-run' : 'write', untilMs };
}

/** `now` is the run's one clock (IB-051: threaded, not read twice); production passes nothing. */
async function main(argv: string[], now: () => number = Date.now): Promise<number> {
  const args = parseFundingCliArgs(argv);
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
    const reads = new PgFundingBackfillReads(db);
    const live = await reads.liveRowsUpTo(args.untilMs);
    if (live > 0) throw new Error(`${live} live funding row(s) lie at or before --until ${iso(args.untilMs)}: the live loop started earlier; pass its first check`);
    const coins = await new PgFundingAlertStore(db).listedCoins();
    if (coins.length === 0) throw new Error('no enabled alert_symbols coin');
    const symbols = coins.map((c) => c.symbol);
    await guard.gate('the replay');

    // 1. settled funding from the venue, paced (the same pacer as the paths)
    const weight = new BinanceWeightTracker();
    const pacer = new WeightPacer(FUNDING_BACKFILL_WEIGHT_PER_MIN, now);
    const perp = new PerpRest({ baseUrl: env.BINANCE_FUTURES_REST_BASE_URL, onWeight: (used) => weight.recordHeader(used) });
    const fromMs = args.untilMs - FUNDING_HISTORY_DAYS * DAY_MS;
    const fetchFrom = fromMs - (POSITIONING_BASELINE_DAYS + 1) * DAY_MS;
    const series = new Map<string, SettledPoint[]>();
    let calls = 0;
    for (const symbol of symbols) {
      const r = await fetchSettled((start) => perp.fundingRateRange(symbol, start, args.untilMs), fetchFrom, args.untilMs, FUNDING_RANGE_LIMIT, () => pacer.take(FUNDING_CALL_WEIGHT));
      calls += r.calls;
      series.set(symbol, r.points);
      say(`settled ${symbol}: ${r.points.length} settlements ${iso((r.points[0]?.time ?? NaN) * 1000)} … ${iso((r.points.at(-1)?.time ?? NaN) * 1000)} (${r.calls} call)`);
    }
    const toMs = replayEnd(series, args.untilMs);
    if (!(toMs > fromMs)) throw new Error(`no settlement to replay before --until ${iso(args.untilMs)}`);
    say(`funding backfill ${args.mode}: build ${env.BUILD_SHA}; ${symbols.length} coins (${symbols.join(', ')}); venue calls ${calls}, weight ${calls * FUNDING_CALL_WEIGHT}`);
    say(`replay [${iso(fromMs)}, ${iso(toMs)}) = ${((toMs - fromMs) / DAY_MS).toFixed(2)} days, a check every 5 min as live; `
      + 'COARSER THAN LIVE: the predicted rate is not historical, so each check reads the rate that settled at the end of its interval (8 h steps)');

    const replay = (base: FundingAlertStore, k: number) => replayFunding({
      store: fundingHistoryStore(base, { params: fundingHistoryParams(symbols, k), coins }),
      venue: new HistoryFundingVenue(series), build: env.BUILD_SHA, log: say, beforeDay: (l) => guard.check(l),
    }, fromMs, toMs);

    // 2. the ×1 rows
    let totals: FundingReplayTotals;
    let counts: Record<string, number>;
    let due = { windows: 0, weight: 0 };
    if (args.mode === 'dry-run') {
      try {
        await db.transaction(async (tx) => {
          const t = await replay(new PgFundingAlertStore(savepointDb(tx)), 1);
          const r = new PgFundingBackfillReads(tx);
          throw new DryRunRollback({ totals: t, counts: await r.backfillCounts(), due: await r.pathsDueNow(now()) });
        });
        throw new Error('unreachable');
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        ({ totals, counts, due } = error.payload);
      }
    } else {
      totals = await replay(new PgFundingAlertStore(db), 1);
      counts = await reads.backfillCounts();
    }
    say(`${args.mode} ×1: ${totals.checks} checks; new rows: enter ${totals.enters}, flip ${totals.flips}, controls ${totals.controls}; stale ${totals.stale}, insufficient ${totals.insufficient}`);
    say(`rows with type = funding, source = backfill now: ${JSON.stringify(counts)}`);
    for (const [m, n] of Object.entries(totals.warnings)) say(`  WARNING ×${n}: ${m}`);
    if (Object.keys(totals.warnings).length > 0) exit = 1;

    // 3. paths (write only)
    if (args.mode === 'dry-run') {
      say(`dry run: rolled back, nothing written. Writing now would measure ${due.windows} closed windows: ${due.weight} weight ≈ ${Math.ceil(due.weight / FUNDING_BACKFILL_WEIGHT_PER_MIN)} min at ${FUNDING_BACKFILL_WEIGHT_PER_MIN}/min`);
    } else {
      await guard.gate('path measuring');
      const candles = new CandlesService({ futuresBaseUrl: env.BINANCE_FUTURES_REST_BASE_URL, spotBaseUrl: env.BINANCE_SPOT_REST_BASE_URL, weight });
      const paths = await measureBackfillPaths(
        { store: new PgOiAlertStore(db), build: env.BUILD_SHA, log: say, klines5m: async (symbol, from, limit) => candles.closedKlines(symbol, '5m', from * 1000, limit) },
        { take: async (w) => { await guard.every30s('path measuring'); await pacer.take(w); } }, now, 50, 'funding',
      );
      const left = await reads.unmeasuredPaths();
      say(`paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}, ${paths.durationSec} s; left ${left.count}`
        + (left.lastCloses ? ` (the last window closes ${iso(left.lastCloses)}; a rerun after it measures them)` : ''));
    }

    // 4. the counts, in memory
    const days = (toMs - fromMs) / DAY_MS;
    const table: FundingCountRow[] = [];
    let examples: CountedFundingAlert[] = [];
    for (const k of FUNDING_HISTORY_MULTIPLIERS) {
      const j = new MemoryFundingJournal();
      const t = await replay(j, k);
      if (Object.keys(t.warnings).length > 0) exit = 1;
      table.push(...fundingCountRows(j, symbols, k, days));
      say(`counts ×${k}: ${t.checks} checks, enter ${t.enters}, flip ${t.flips}, controls ${t.controls} (random ${j.controls.filter((c) => c.kind === 'random').length}, near-miss ${j.controls.filter((c) => c.kind === 'near_miss').length})`);
      if (k === 1) {
        const mismatch = fundingCrossCheck(j, counts);
        if (mismatch) { say(`MISMATCH: ${mismatch}`); exit = 1; }
        examples = j.alerts;
      }
    }
    printTable(table, fromMs, toMs, days);
    printAlerts(examples);
    say(`FUNDING_HISTORY_JSON ${JSON.stringify({
      mode: args.mode, from: iso(fromMs), to: iso(toMs), until: iso(args.untilMs), days: Math.round(days * 1000) / 1000, venueCalls: calls, written: counts, table,
      alerts: examples.map((a) => ({ event: a.event, symbol: a.symbol, side: a.side, at: iso(a.atMs), ratePer8h: a.details.ratePer8h, rarity: a.details.rarity, band: a.details.band, episodeHours: a.details.episodeHours ?? null })),
    })}`);
  } finally {
    say(`done in ${Math.round((now() - started) / 1000)} s; lowest MemAvailable seen by the guard: ${guard.minSeenMb ?? 'unreadable'} MB`);
    await db.end();
  }
  return exit;
}

function printTable(rows: readonly FundingCountRow[], fromMs: number, toMs: number, days: number): void {
  say(`counts over [${iso(fromMs)}, ${iso(toMs)}) = ${days.toFixed(2)} days; per week = count / days × 7`);
  say('coin      ×    floor/8h   enters (high/low)  /week  flips  /week  other-tail');
  for (const r of rows) {
    say(`${r.symbol.padEnd(9)} ${String(r.multiplier).padEnd(4)} ${(r.floorPer8h * 100).toFixed(4).padStart(7)} %  ${String(r.enters).padStart(5)} (${r.high}/${r.low})`.padEnd(48)
      + `${String(r.perWeek).padStart(6)}  ${String(r.flips).padStart(5)}  ${String(r.flipsPerWeek).padStart(5)}  ${String(r.otherTail).padStart(10)}`);
  }
}

/** The ×1 alerts, one line each, for the owner report's examples. */
function printAlerts(alerts: readonly CountedFundingAlert[]): void {
  say('alerts ×1: event  coin       side  at (UTC)          rate/8h     rarity  band (raw rate)');
  for (const a of [...alerts].sort((x, y) => x.atMs - y.atMs)) {
    const d = a.details as { ratePer8h: number; rarity: number; band: { lo: number; hi: number }; episodeHours?: number };
    say(`  ${a.event.padEnd(5)} ${a.symbol.padEnd(10)} ${a.side.padEnd(4)}  ${iso(a.atMs).slice(0, 16)}  ${(d.ratePer8h * 100).toFixed(4).padStart(8)} %  ${d.rarity.toFixed(3)}  `
      + `[${(d.band.lo * 100).toFixed(4)} %, ${(d.band.hi * 100).toFixed(4)} %]${d.episodeHours !== undefined ? `  after ${d.episodeHours.toFixed(0)} h` : ''}`);
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    // eslint-disable-next-line no-console
    console.error(`funding backfill failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
