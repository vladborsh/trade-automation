/**
 * IB-056 — `npm run agg-coverage [-- --from 2026-07-01 --to 2026-10-13 --tf 15m,1h]`
 *
 * What `candles_agg` holds against what the 1m tape could support, per `(symbol, market, tf)`.
 * Unbounded by default: the whole tape, which is the figure the dashboard block cannot afford to
 * compute per request.
 *
 * **It reports. It does not derive.** The gap it prints is a judgement about cost and timing that
 * belongs to a person — and a check that quietly repaired what it measures would hide the backlog
 * it exists to surface. The command to act on its output is `npm run derive`, and this prints it.
 *
 * Boots config + database only, like the derive and backfill CLIs: booting `AppModule` would open
 * every venue socket and start a second set of collectors writing the same tables.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from './db.module';
import { DB, type Db } from './db.port';
import { AGG_TIMEFRAMES } from '../derive/bucket';
import type { AggTimeframe } from '../collectors/writers/tables';
import { aggCoverage } from './pg/agg-coverage-reads';
import { aggCoverage as toViews, aggTotals } from '../web/agg-coverage';

@Module({ imports: [AppConfigModule, DbModule] })
class AggCoverageCliModule {}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** A day (`2026-08-01`) or an instant; both read as UTC, never the box's timezone. */
function parseBound(value: string, what: string): number {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) throw new Error(`--${what} is not a date: ${value}`);
  return ms;
}

function iso(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

async function main(): Promise<void> {
  const fromArg = arg('from');
  const toArg = arg('to');
  // Default: everything. The 1m tape's own first row would need a query to find, and `0` reads as
  // "no lower bound" to every caller without one.
  const fromMs = fromArg ? parseBound(fromArg, 'from') : 0;
  const nowMs = toArg ? parseBound(toArg, 'to') : Date.now();
  if (nowMs <= fromMs) throw new Error(`--to must be after --from`);

  const tfArg = arg('tf');
  const timeframes: AggTimeframe[] = tfArg
    ? tfArg.split(',').map((t) => {
        const tf = t.trim() as AggTimeframe;
        if (!AGG_TIMEFRAMES.includes(tf)) throw new Error(`--tf: ${t} is not one of ${AGG_TIMEFRAMES.join(', ')}`);
        return tf;
      })
    : [...AGG_TIMEFRAMES];

  const app = await NestFactory.createApplicationContext(AggCoverageCliModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Db | null>(DB);
    if (!db) throw new Error('DATABASE_URL is not set: nothing to report on');

    const started = Date.now();
    const rows = toViews(await aggCoverage(db, { fromMs, nowMs, venue: 'binance', timeframes }));
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    const bound = fromMs === 0 ? 'the whole tape' : new Date(fromMs).toISOString().slice(0, 10);
    console.log(
      `aggregate coverage — ${bound} … ${new Date(nowMs).toISOString().slice(0, 16)}Z, ` +
        `${rows.length} series × timeframe, ${elapsed} s`,
    );
    console.log('the live edge is excluded per timeframe: a bucket still filling is not yet answerable\n');

    console.log('per timeframe — floor and max, not a mean (a mean over a 5:1 population describes none of it):');
    for (const t of aggTotals(rows)) {
      console.log(
        `  ${t.tf.padEnd(4)} ${String(t.series).padStart(3)} series  ` +
          `derivable ${String(t.derivable).padStart(7)}  unfetchable ${String(t.unfetchable).padStart(6)}  ` +
          `held floor ${String(t.heldFloor).padStart(6)}  max ${String(t.heldMax).padStart(6)}`,
      );
    }

    const backlog = rows.filter((r) => r.derivable > 0);
    if (backlog.length === 0) {
      console.log('\nno derivable gap: every bucket the tape supports is in candles_agg.');
    } else {
      console.log(`\n${backlog.length} series × timeframe with a derivable gap, worst first:`);
      for (const r of backlog.slice(0, 40)) {
        console.log(
          `  ${r.symbol.padEnd(10)} ${r.market.padEnd(5)} ${r.tf.padEnd(4)} ` +
            `derivable ${String(r.derivable).padStart(7)}  held ${String(r.held).padStart(6)}  ` +
            `unfetchable ${String(r.unfetchable).padStart(5)}  oldest ${iso(r.oldestDerivable)}`,
        );
      }
      if (backlog.length > 40) console.log(`  … ${backlog.length - 40} more`);
      console.log('\nto close it: npm run derive -- --from <oldest above> --to <today> [--tf <tf>]');
    }
  } finally {
    await app.close();
  }
}

// An exit code reports whether the job ran, never what it found: a non-zero on a found gap would
// make a cron treat a true report as a broken command.
void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
