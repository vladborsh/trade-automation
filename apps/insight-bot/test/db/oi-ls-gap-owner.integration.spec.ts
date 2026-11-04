import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OiLsPoller, STREAM_ID } from '../../src/collectors/binance-perp/oi-ls.poller';
import { Writers } from '../../src/collectors/writers/batch-writer';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { MetricsService } from '../../src/ops/metrics.service';
import { StreamRegistry } from '../../src/ops/stream-registry';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import type { FuturesDataClient } from '../../src/venues/binance/futures-data.client';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-104 against a real Postgres. Four symbols: XPT (a TradFi perp) and three crypto perps. The fake
 * venue never serves:
 * - XPT on `CLOSED_A`, a closed session the crypto perps traded through: **the venue's**;
 * - XPT on `CLOSED_B..`, a closed session running straight into `OUTAGE`, where NO symbol was
 *   stored (our poller down): **ours**, because a poller outage covering a closed session is ours;
 * - every crypto perp on `OUTAGE`: **ours**, one window each.
 *
 * So health must say 4 ours, 1 venue's.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('oi-ls-gap-owner.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const SLOT = 5 * 60_000;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 20);
const LAST = Math.floor(NOW / SLOT) * SLOT - 3 * SLOT;
const FIRST = LAST - 288 * SLOT;
const CLOSED_A = [LAST - 200 * SLOT, LAST - 199 * SLOT];
const CLOSED_B = [LAST - 100 * SLOT, LAST - 99 * SLOT, LAST - 98 * SLOT];
const OUTAGE = [LAST - 97 * SLOT, LAST - 96 * SLOT];
const SYMBOLS = ['XPTUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

function venue() {
  return {
    async fetchBackward(q: { endpoint: string; symbol: string }) {
      const skip = new Set(q.symbol === 'XPTUSDT' ? [...CLOSED_A, ...CLOSED_B, ...OUTAGE] : OUTAGE);
      const rows: unknown[] = [];
      for (let ts = FIRST; ts <= LAST; ts += SLOT) {
        if (skip.has(ts)) continue;
        rows.push(q.endpoint === 'openInterestHist'
          ? { symbol: q.symbol, sumOpenInterest: '10', sumOpenInterestValue: '20', timestamp: ts }
          : q.endpoint === 'takerlongshortRatio'
            ? { buySellRatio: '1', buyVol: '1', sellVol: '1', timestamp: ts }
            : { symbol: q.symbol, longShortRatio: '1', longAccount: '0.5', shortAccount: '0.5', timestamp: ts });
      }
      return rows;
    },
    async fetchPage() { return []; },
  } as unknown as FuturesDataClient;
}

maybeDescribe('IB-104 OI/LS gap owner against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_gapowner', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 86_400_000), new Date(NOW + 86_400_000));
    for (const s of SYMBOLS) {
      await db.query(`insert into symbols (id, base, quote, binance_perp, listed_perp, active) values ($1, $2, 'USDT', $1, '2026-01-30', true)`, [s, s.replace('USDT', '')]);
    }
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('a closed session alone is the venue\'s; one that runs into a universe-wide outage is ours; the outage is ours on every symbol', async () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    const config = { symbols: SYMBOLS.map((s) => ({ binance_perp: s })), env: { get: () => undefined } } as never;
    const poller = new OiLsPoller(config, db, new PartitionMaintenanceService(db), new Writers(db, metrics),
      new BinanceWeightTracker(), metrics, streams, venue());
    await poller.backfill(NOW);

    const rows = await db.query<{ symbol: string; gap_from: Date; gap_to: Date }>(
      'select symbol, gap_from, gap_to from collector_gaps where stream = $1 order by symbol, gap_from', [STREAM_ID]);
    // XPT: CLOSED_A, and CLOSED_B + OUTAGE as one contiguous range; one OUTAGE range per crypto perp
    expect(rows.map((r) => [r.symbol, new Date(r.gap_from).getTime(), new Date(r.gap_to).getTime()])).toEqual([
      ['BTCUSDT', OUTAGE[0], OUTAGE[1]],
      ['ETHUSDT', OUTAGE[0], OUTAGE[1]],
      ['SOLUSDT', OUTAGE[0], OUTAGE[1]],
      ['XPTUSDT', CLOSED_A[0], CLOSED_A[1]],
      ['XPTUSDT', CLOSED_B[0], OUTAGE[1]],
    ]);
    const row = streams.snapshot(NOW).find((s) => s.id === STREAM_ID);
    expect({ ours: row?.gapsOpen, venue: row?.gapsVenue }).toEqual({ ours: 4, venue: 1 });
  }, 60_000);
});
