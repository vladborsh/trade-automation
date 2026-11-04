/**
 * IB-116 (architecture/oi-divergence-design-2026-11-04.md §9, V31) — the one-off OI divergence history run.
 * Standalone: it does NOT boot Nest (no poller, no second alert loop, no Telegram). Run once on the box:
 *
 *   docker exec insight-bot-insight-bot-1 node dist/alerts/oi-divergence/backfill/backfill.cli.js --dry-run
 *   docker exec insight-bot-insight-bot-1 node dist/alerts/oi-divergence/backfill/backfill.cli.js --write
 *
 * - `--dry-run`: the whole replay inside ONE transaction, then rolled back — the real SQL, keys and checks,
 *   so the counts are what `--write` would write (0 on a rerun); no path is measured, no kline weight beyond
 *   the bar reads.
 * - `--write`: the replay, committed row by row (idempotent: a rerun writes 0), then the paths of every closed
 *   window, paced at ≤ 200 weight a minute. A rerun after the last 72 h window closes measures the rest.
 *
 * On the box (TL ruling, option A; 109 MB peak RSS measured on Linux):
 *   node --max-old-space-size=40 --max-semi-space-size=1 --optimize-for-size dist/alerts/oi-divergence/backfill/backfill.cli.js --dry-run
 * It refuses to start the replay or the path measuring below 170 MB MemAvailable, and pauses / aborts below
 * 120 MB while running (memory-guard.ts).
 *
 * The environment is the bot's own (`validateEnv`): DATABASE_URL, BUILD_SHA (production refuses `dev`), the
 * Binance base URL. Exit 0 when the run completed, whatever it found; 1 on a failure.
 */
import { OI_DIVERGENCE_TF_SEC, WEB_MAX_CANDLE_BARS, type OiDivergenceTf } from '@trade-automation/contracts';
import { validateEnv } from '../../../config/env.schema';
import { PgDatabase } from '../../../db/pg/pg-database';
import { OiWindowReader } from '../../../insights/divergence/oi-window.reader';
import { BinanceWeightTracker } from '../../../venues/binance/binance-weight.tracker';
import { CandlesService, PERP_PAGE_WEIGHT } from '../../../web/market/candles.service';
import { PgBackfillReads } from '../pg/backfill-reads';
import { PgOiAlertStore } from '../pg/oi-alerts.repo';
import { measureBackfillPaths, replayHistory, type BackfillReport, type HistoryBackfillPorts } from './history-backfill';
import { MemoryGuard, parseMemAvailableMb } from './memory-guard';
import { WeightPacer } from './weight-pacer';
import { readFile } from 'node:fs/promises';

/** V31: the run's own budget, well under the 2 400 a minute the IP has (≈ 8 % while it runs). */
export const BACKFILL_WEIGHT_PER_MIN = 200;
/** The venue's page for the chart's klines path (CandlesService): 1 500 bars at weight 10. */
const PAGE_BARS = 1_500;

class DryRunRollback extends Error {
  constructor(readonly payload: { report: BackfillReport; counts: Record<string, number> }) { super('dry run: rolled back'); }
}

// eslint-disable-next-line no-console
const say = (line: string): void => console.log(line);

/** `now` is the run's one clock (IB-051: threaded, not read twice); production passes nothing. */
async function main(argv: string[], now: () => number = Date.now): Promise<void> {
  const mode = argv.includes('--dry-run') ? 'dry-run' : argv.includes('--write') ? 'write' : null;
  if (mode === null || (argv.includes('--dry-run') && argv.includes('--write'))) {
    throw new Error('usage: backfill.cli.js --dry-run | --write  (exactly one)');
  }
  const env = validateEnv(process.env as Record<string, unknown>);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new PgDatabase(env.DATABASE_URL);
  const weight = new BinanceWeightTracker();
  const candles = new CandlesService({ futuresBaseUrl: env.BINANCE_FUTURES_REST_BASE_URL, spotBaseUrl: env.BINANCE_SPOT_REST_BASE_URL, weight });
  const pacer = new WeightPacer(BACKFILL_WEIGHT_PER_MIN, now);
  // TL condition: the live bot shares the box — step back when MemAvailable is low (memory-guard.ts)
  const guard = new MemoryGuard({
    availableMb: async () => readFile('/proc/meminfo', 'utf8').then(parseMemAvailableMb, () => null),
    now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: say,
  });
  const paced = { take: async (w: number) => { await guard.every30s('path measuring'); await pacer.take(w); } };
  const reader = new OiWindowReader(db);
  const started = now();
  say(`oi backfill ${mode}: build ${env.BUILD_SHA}, budget ${BACKFILL_WEIGHT_PER_MIN} weight/min`);

  const bars: HistoryBackfillPorts['bars'] = async (symbol, tf, fromSec, toSec) => {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf as OiDivergenceTf];
    const out: Array<{ time: number; open: number; high: number; low: number; close: number }> = [];
    for (let from = fromSec; from < toSec; from += WEB_MAX_CANDLE_BARS * tfSec) {
      const to = Math.min(toSec, from + WEB_MAX_CANDLE_BARS * tfSec);
      // the documented page weight, before the call: aligned pages may add one at each end
      await pacer.take(PERP_PAGE_WEIGHT * (Math.ceil((to - from) / tfSec / PAGE_BARS) + 1));
      out.push(...await candles.candles('perp', symbol, tf, from * 1000, to * 1000));
    }
    return out.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  };
  const portsOn = (handle: ConstructorParameters<typeof PgOiAlertStore>[0]): HistoryBackfillPorts => {
    const reads = new PgBackfillReads(handle);
    return {
      store: new PgOiAlertStore(handle),
      bars,
      oiWindow: (symbol, from, to) => reader.read(symbol, from, to),
      firstStoredOi: (symbol) => reads.firstStoredOi(symbol),
      liveStart: () => reads.liveStart(),
      build: env.BUILD_SHA,
      log: say,
      beforeChunk: (label) => guard.check(label),
    };
  };

  try {
    if (mode === 'dry-run') {
      try {
        await db.transaction(async (tx) => {
          await guard.gate('the replay');
          const report = await replayHistory(portsOn(tx), Math.floor(now() / 1000));
          throw new DryRunRollback({ report, counts: await new PgBackfillReads(tx).backfillCounts() });
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        printReport(error.payload.report, error.payload.counts, pacer.total);
        say(`dry run: rolled back, nothing written. Measuring the ${error.payload.report.paths.dueNow} closed windows would cost ${error.payload.report.paths.dueNowWeight} weight ≈ ${Math.ceil(error.payload.report.paths.dueNowWeight / BACKFILL_WEIGHT_PER_MIN)} min at ${BACKFILL_WEIGHT_PER_MIN}/min.`);
      }
    } else {
      const ports = portsOn(db);
      await guard.gate('the replay');
      const report = await replayHistory(ports, Math.floor(now() / 1000));
      const reads = new PgBackfillReads(db);
      printReport(report, await reads.backfillCounts(), pacer.total);
      const barsWeight = pacer.total;
      await guard.gate('path measuring');
      const paths = await measureBackfillPaths(
        { store: ports.store, build: env.BUILD_SHA, log: say,
          klines5m: async (symbol, from, limit) => candles.closedKlines(symbol, '5m', from * 1000, limit) },
        paced, now,
      );
      const left = await reads.unmeasuredBackfillPaths();
      paths.left = left.count;
      say(`paths: measured ${paths.measured}, failed ${paths.failed}, weight ${paths.weight}, ${paths.durationSec} s; `
        + `left ${left.count}${left.lastCloses ? ` (the last window closes ${new Date(left.lastCloses * 1000).toISOString()}; a rerun after it measures them)` : ''}`);
      say(`total weight ${barsWeight + paths.weight} (bars ${barsWeight}, paths ${paths.weight})`);
    }
    say(`done in ${Math.round((now() - started) / 1000)} s; lowest MemAvailable seen by the guard: ${guard.minSeenMb ?? 'unreadable'} MB`);
  } finally {
    await db.end();
  }
}

function printReport(r: BackfillReport, counts: Record<string, number>, barsWeight: number): void {
  const iso = (s: number | null) => (s === null ? '—' : new Date(s * 1000).toISOString());
  say(`live journal starts ${iso(r.liveStart)}: the run evaluates every close before the live loop's first`);
  for (const c of r.coins) say(`  ${c.symbol}: OI from ${iso(c.firstOi)}; bars 15m ${c.bars['15m']}, 1h ${c.bars['1h']}, 4h ${c.bars['4h']}`);
  for (const t of r.perTf) {
    say(`  ${t.tf}: ${t.closes} closes ${iso(t.firstClose)} … ${iso(t.lastClose)}; alerts ${t.alerts}, controls ${t.controls}, near-misses ${t.nearMisses}, skips ${t.skips}, failed ${t.failed}`);
  }
  say(`rows with source = backfill now: ${JSON.stringify(counts)}`);
  say(`paths written ${r.paths.rows}: ${r.paths.dueNow} windows closed (weight ${r.paths.dueNowWeight}), ${r.paths.open} still open (last closes ${iso(r.paths.lastWindowCloses)})`);
  say(`bar reads: weight ${barsWeight}`);
  for (const [k, n] of Object.entries(r.warnings)) say(`  warning ×${n}: ${k}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`oi backfill failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
