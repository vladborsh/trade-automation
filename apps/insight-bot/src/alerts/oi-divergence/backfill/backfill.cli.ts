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
 *
 * IB-144 (V45, V47) — the hidden run:
 *   … backfill.cli.js --dry-run --kinds hidden --dump /tmp/ib144-dry.jsonl
 *   … backfill.cli.js --write   --kinds hidden --dump /tmp/ib144-write.jsonl
 * - `--kinds hidden`: writes hidden alerts and hidden near-misses only (with their paths), each pair up to its
 *   hidden-aware live start (`hiddenEnd`); nothing regular and no control. Without it: both kinds (IB-116's run).
 * - `--dump <file>`: one JSON line per hidden detection with its bars and raw OI (V47's independent recheck,
 *   `hidden-guard.cli.js`), a `summary` line last with the per-(tf, kind) counts and every detection's key.
 * The per-(tf, kind) table is printed either way: found inside IB-116's window (both kinds on the same closes),
 * bullish, repeats, written, skipped because live, near-misses by rule.
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
import { appendFileSync, writeFileSync } from 'node:fs';
import { OI_DIVERGENCE_KINDS, type OiDivergenceKind } from '@trade-automation/contracts';

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
    throw new Error('usage: backfill.cli.js --dry-run | --write  (exactly one) [--kinds regular,hidden] [--dump <file.jsonl>]');
  }
  const kinds = parseKinds(argValue(argv, '--kinds'));
  const dump = argValue(argv, '--dump');
  if (dump !== null) writeFileSync(dump, '');
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
  say(`oi backfill ${mode}: build ${env.BUILD_SHA}, budget ${BACKFILL_WEIGHT_PER_MIN} weight/min, writes ${kinds.join(' + ')}${dump ? `, dump ${dump}` : ''}`);

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
      hiddenEnd: (symbol, tf) => reads.hiddenEnd(symbol, tf),
      hasLive: (...a) => reads.hasLive(...a),
      build: env.BUILD_SHA,
      log: say,
      beforeChunk: (label) => guard.check(label),
      onHidden: dump === null ? undefined : (d) => appendFileSync(dump, `${JSON.stringify({ type: 'hidden', ...d })}\n`),
    };
  };

  try {
    if (mode === 'dry-run') {
      try {
        await db.transaction(async (tx) => {
          await guard.gate('the replay');
          const report = await replayHistory(portsOn(tx), Math.floor(now() / 1000), { kinds });
          throw new DryRunRollback({ report, counts: await new PgBackfillReads(tx).backfillCounts() });
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        printReport(error.payload.report, error.payload.counts, pacer.total);
        if (dump !== null) appendFileSync(dump, `${JSON.stringify(summaryLine(mode, error.payload.report))}\n`);
        say(`dry run: rolled back, nothing written. Measuring the ${error.payload.report.paths.dueNow} closed windows would cost ${error.payload.report.paths.dueNowWeight} weight ≈ ${Math.ceil(error.payload.report.paths.dueNowWeight / BACKFILL_WEIGHT_PER_MIN)} min at ${BACKFILL_WEIGHT_PER_MIN}/min.`);
      }
    } else {
      const ports = portsOn(db);
      await guard.gate('the replay');
      const report = await replayHistory(ports, Math.floor(now() / 1000), { kinds });
      const reads = new PgBackfillReads(db);
      printReport(report, await reads.backfillCounts(), pacer.total);
      if (dump !== null) appendFileSync(dump, `${JSON.stringify(summaryLine(mode, report))}\n`);
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
  // IB-144 (V45): regular beside hidden over the same closes (IB-116's window), per TF
  say('by kind (found = inside the live-start window; written / skipped-live = any close):');
  for (const k of r.kinds) {
    const tf = r.perTf.find((t) => t.tf === k.tf);
    const weeks = tf?.firstClose != null && tf.lastClose != null ? (tf.lastClose - tf.firstClose) / 604_800 : null;
    const perWeek = weeks && weeks > 0 ? (k.found / weeks).toFixed(2) : '—';
    say(`  ${k.tf} ${k.kind.padEnd(7)}: found ${k.found} (${perWeek}/week over ${weeks?.toFixed(2) ?? '—'} weeks, ${r.coins.length} coins), bullish ${k.bullish}, `
      + `bearish ${k.found - k.bullish}, repeats ${k.repeats}; written ${k.written}, skipped live ${k.skippedLive}; `
      + `near-misses ${JSON.stringify(k.nearMisses)} (written ${k.nearMissesWritten})`);
  }
  say(`  B with both kinds: ${JSON.stringify(r.bothKinds)}`);
  if (r.hiddenSkipped.length > 0) say(`  hidden NOT written (no hidden-aware live control yet; rerun later): ${r.hiddenSkipped.join(', ')}`);
  for (const [pair, last] of Object.entries(r.hiddenLast)) say(`  hidden written through the close ${iso(last)} on ${pair}`);
}

/** The dump's last line: the counts and every detection's key (regular too — V47's «regular unchanged» compares them). */
function summaryLine(mode: string, r: BackfillReport): Record<string, unknown> {
  return {
    type: 'summary', mode, liveStart: r.liveStart, perTf: r.perTf, kinds: r.kinds, bothKinds: r.bothKinds, hiddenSkipped: r.hiddenSkipped,
    hiddenLast: r.hiddenLast, coins: r.coins, detections: r.detections,
  };
}

function argValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
  return v;
}

/** `--kinds hidden` / `regular,hidden`; absent = both (IB-116's run). */
export function parseKinds(value: string | null): OiDivergenceKind[] {
  if (value === null) return [...OI_DIVERGENCE_KINDS];
  const out = value.split(',').map((k) => k.trim());
  for (const k of out) if (!(OI_DIVERGENCE_KINDS as readonly string[]).includes(k)) throw new Error(`--kinds: unknown kind "${k}" (regular, hidden)`);
  return out as OiDivergenceKind[];
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`oi backfill failed: ${(error as Error).stack ?? String(error)}`);
    process.exit(1);
  });
}
