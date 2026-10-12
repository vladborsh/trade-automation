import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WebFrameTimeframe } from '@trade-automation/contracts';
import { AppConfigModule } from '../config/config.module';
import { DB, type Db } from '../db/db.port';
import { DbModule } from '../db/db.module';
import { FeaturePassService } from './feature-pass.service';
import { FRAME_TIMEFRAMES, TIMEFRAME_MS, lastCloseMs } from './recheck-schedule';

/**
 * IB-015 — `npm run features -- --from 2026-10-01 --to 2026-10-08 [--tf 4h] [--symbol BTCUSDT]`
 *
 * Recomputes frames over a range of closes: what the live pass does every fifteen minutes, run
 * deliberately over history.
 *
 * Not `AppModule`, for the same reason `derive.cli.ts` is not: booting that opens every venue
 * socket and starts a second set of collectors against the same database.
 *
 * **Safe to re-run.** `insertFrame` is `on conflict do nothing` on the full key including the
 * revision, so a second run over the same range writes nothing rather than rewriting rows that
 * something may already have armed on. Re-running a range is how a backfill is finished after an
 * interruption, and it must not be how an audit trail is destroyed.
 */
@Module({ imports: [AppConfigModule, DbModule] })
class FeaturesCliModule {}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

/** A day (`2026-10-01`) or an instant; both read as UTC, never the box's timezone. */
function parseBound(value: string, what: string): number {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) throw new Error(`--${what} is not a date: ${value}`);
  return ms;
}

const USAGE = 'usage: npm run features -- --from <date> --to <date> [--tf 15m,4h] [--symbol ID]';

async function main(): Promise<void> {
  const fromArg = arg('from');
  const toArg = arg('to');
  if (fromArg === null || toArg === null) throw new Error(USAGE);
  const from = parseBound(fromArg, 'from');
  const to = parseBound(toArg, 'to');
  if (to <= from) throw new Error(`--to must be after --from (${fromArg} .. ${toArg})`);

  const tfArg = arg('tf');
  const timeframes: WebFrameTimeframe[] = tfArg === null
    ? [...FRAME_TIMEFRAMES]
    : tfArg.split(',').map((t) => t.trim()).map((t) => {
      if (!FRAME_TIMEFRAMES.includes(t as WebFrameTimeframe)) {
        throw new Error(`--tf must be one of ${FRAME_TIMEFRAMES.join(',')}: got ${t}`);
      }
      return t as WebFrameTimeframe;
    });
  const onlySymbol = arg('symbol');

  const app = await NestFactory.createApplicationContext(FeaturesCliModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const db = app.get<Db | null>(DB);
    if (!db) throw new Error('DATABASE_URL is not set: nothing to compute frames from');
    const service = new FeaturePassService(db);

    process.stdout.write(`spec fingerprint ${FeaturePassService.fingerprint()}\n`);
    let written = 0;
    let amended = 0;
    let unchanged = 0;
    let conflicts = 0;
    const failures: string[] = [];

    for (const tf of timeframes) {
      const span = TIMEFRAME_MS[tf];
      // Only CLOSED bars: the first close at or after `from`, up to the last one before `to`.
      const first = Math.ceil(from / span) * span;
      const last = lastCloseMs(tf, Math.min(to, Date.now()));
      for (let closeMs = first; closeMs <= last; closeMs += span) {
        if (onlySymbol !== null) {
          try {
            const outcome = await service.runClose(onlySymbol, tf, closeMs, Date.now());
            conflicts += outcome.conflicts;
            if (outcome.action === 'written') written += 1;
            else if (outcome.action === 'amended') amended += 1;
            else unchanged += 1;
          } catch (err) {
            failures.push(`${onlySymbol} ${tf} ${new Date(closeMs).toISOString()}: ${(err as Error).message}`);
          }
        } else {
          const summary = await service.runPass(tf, closeMs, Date.now());
          written += summary.written;
          amended += summary.amended;
          unchanged += summary.unchanged;
          conflicts += summary.conflicts;
          for (const f of summary.failed) {
            failures.push(`${f.symbol} ${tf} ${new Date(closeMs).toISOString()}: ${f.error}`);
          }
        }
      }
    }

    process.stdout.write(
      `\n${written} written, ${amended} amended, ${unchanged} unchanged, ${conflicts} conflicts\n`,
    );
    if (failures.length > 0) {
      // Reported, and the exit code still reflects the JOB rather than the findings: the run
      // completed. A non-zero exit here would make a scheduled backfill look broken every time
      // one symbol has no history.
      process.stdout.write(`${failures.length} symbol-closes failed:\n`);
      for (const failure of failures.slice(0, 20)) process.stdout.write(`  ${failure}\n`);
      if (failures.length > 20) process.stdout.write(`  … and ${failures.length - 20} more\n`);
    }
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
