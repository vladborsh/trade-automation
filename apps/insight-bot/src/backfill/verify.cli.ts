/**
 * IB-012 — the archive/live agreement check (§5's acceptance criterion):
 *
 *   npm run backfill:verify -- --symbol BTCUSDT --day 2026-09-20 [--market perp]
 *
 * It compares, for one UTC day and minute by minute:
 *   1. the rows STORED in `candles_1m` (whoever wrote them — the collectors, or a previous
 *      archive import: the `source` column says which), against
 *   2. the archive's own file for that day, downloaded fresh and never written.
 *
 * It writes nothing. That is deliberate: `candles_1m`'s conflict key does not include `source`
 * (D12), so importing a day the collectors already covered would REPLACE their rows and destroy
 * the very thing being compared.
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ArchiveClient } from '@trade-automation/binance-client';
import { AppConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { DB, type Db } from '../db/db.port';
import { candlesForDay } from '../db/pg/backfill-reads';
import type { Market } from '../collectors/writers/tables';
import { fetchKlineDay } from './archive-sources';
import { compareCandles, renderComparison, type ComparableBar } from './compare-candles';
import { binanceKlineRange } from './rest-tail';
import { WeightThrottle } from '@trade-automation/binance-client';

@Module({ imports: [AppConfigModule, DbModule] })
class VerifyCliModule {}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function main(): Promise<void> {
  const symbol = arg('symbol');
  const day = arg('day');
  const market = (arg('market') ?? 'perp') as Market;
  // `archive` is the acceptance check; `rest` exists because a day only gains an archive file
  // after it closes, so today's live rows can only be checked against the API.
  const against = (arg('against') ?? 'archive') as 'archive' | 'rest';
  if (!symbol || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !['archive', 'rest'].includes(against)) {
    console.error('usage: npm run backfill:verify -- --symbol BTCUSDT --day YYYY-MM-DD [--market perp|spot] [--against archive|rest]');
    process.exit(2);
  }

  const app = await NestFactory.createApplicationContext(VerifyCliModule, { logger: ['warn', 'error'] });
  try {
    const db = app.get<Db | null>(DB);
    if (!db) { console.error('DATABASE_URL is not set.'); process.exit(2); }

    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const stored = await candlesForDay(db, { venue: 'binance', symbol, market }, dayStart, dayEnd);
    if (stored.length === 0) {
      console.error(`nothing stored for ${symbol} ${market} on ${day} — nothing to compare.`);
      process.exit(2);
    }
    const sources = [...new Set(stored.map((r) => r.source))].sort();

    let reference: ComparableBar[];
    if (against === 'archive') {
      const archive = await fetchKlineDay(new ArchiveClient(), market, symbol, day);
      if (archive.kind === 'absent') {
        console.error(`the archive has no daily file for ${symbol} ${market} ${day} (a day only appears after it closes).`);
        process.exit(2);
      }
      reference = archive.rows.map((r) => ({
        openTime: r.openTime.getTime(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
      }));
    } else {
      // only the minutes actually stored, so an unfinished day is not reported as missing
      const from = Math.min(...stored.map((r) => r.openTime));
      const to = Math.max(...stored.map((r) => r.openTime)) + 60_000;
      const rows = await binanceKlineRange(
        { fetchImpl: ((url, init) => fetch(url, init)) as never, throttle: new WeightThrottle() },
        market, symbol, from, to,
      );
      reference = rows.map((r) => ({
        openTime: r.openTime.getTime(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
      }));
    }

    const result = compareCandles(stored, reference);

    console.log(`${symbol} ${market} ${day} — stored vs ${against}`);
    console.log(`  stored rows: ${stored.length} (source: ${sources.join(', ')})`);
    console.log(`  ${against} rows: ${reference.length}`);
    console.log(`  ${renderComparison(`${day} ${symbol} ${market}`, result)}`);
    if (!result.agree) {
      for (const d of result.differences.slice(0, 10)) {
        console.log(`    ${new Date(d.openTime).toISOString()} ${d.field}: stored ${d.left} vs ${against} ${d.right}`);
      }
    }
    process.exitCode = result.agree ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main().catch((error) => { console.error(error); process.exit(1); });
