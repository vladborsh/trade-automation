/**
 * IB-014 — `npm run derive -- --from 2026-08-01 --to 2026-09-01 [--tf 4h]`
 *
 * Re-derives `candles_agg` over history from the 1m rows already stored. Idempotent: the upsert is
 * keyed on (venue, market, symbol, tf, open_time), so running it twice writes the same bars.
 *
 * Like the backfill and gap-report CLIs, this boots config + database only — booting `AppModule`
 * would open every venue socket and start a second set of collectors writing the same tables.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { DB, type Db } from '../db/db.port';
import { WritersModule } from '../collectors/writers/writers.module';
import { Writers } from '../collectors/writers/batch-writer';
import type { AggTimeframe } from '../collectors/writers/tables';
import { AGG_TIMEFRAMES } from './bucket';
import { DeriveService } from './derive.service';

@Module({ imports: [AppConfigModule, DbModule, WritersModule] })
class DeriveCliModule {}

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

async function main(): Promise<void> {
  const fromArg = arg('from');
  const toArg = arg('to');
  if (!fromArg || !toArg) {
    throw new Error('usage: npm run derive -- --from 2026-08-01 --to 2026-09-01 [--tf 4h]');
  }
  const from = parseBound(fromArg, 'from');
  const to = parseBound(toArg, 'to');
  if (to <= from) throw new Error(`--to (${toArg}) must be after --from (${fromArg})`);

  const tfArg = arg('tf');
  const timeframes: AggTimeframe[] = tfArg
    ? tfArg.split(',').map((t) => {
        const tf = t.trim() as AggTimeframe;
        if (!AGG_TIMEFRAMES.includes(tf)) throw new Error(`--tf: ${t} is not one of ${AGG_TIMEFRAMES.join(', ')}`);
        return tf;
      })
    : [...AGG_TIMEFRAMES];

  const app = await NestFactory.createApplicationContext(DeriveCliModule, { logger: ['log', 'warn', 'error'] });
  try {
    const db = app.get<Db | null>(DB);
    if (!db) throw new Error('DATABASE_URL is not set: nothing to derive from');
    const service = new DeriveService(db, app.get(Writers));
    const started = Date.now();
    const written = await service.deriveRange(from, to, timeframes);
    process.stdout.write(
      `\nderived ${written} bars for ${timeframes.join(', ')} over ` +
        `[${new Date(from).toISOString()}, ${new Date(to).toISOString()}) in ${Math.round((Date.now() - started) / 1000)} s\n`,
    );
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
