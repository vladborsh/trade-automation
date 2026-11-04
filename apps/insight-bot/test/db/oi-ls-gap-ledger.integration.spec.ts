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
 * IB-BUG-020 against a real Postgres: three boots over a venue that never serves one slot write ONE
 * `collector_gaps` row, not three; a fourth boot after the venue starts serving it marks that row
 * repaired. The fake venue serves two days ending three slots before `now`. That keeps the symbol
 * stale, so each boot backfills it, as a deploy's downtime does on the box.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('oi-ls-gap-ledger.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const SLOT = 5 * 60_000;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 20);
const SYMBOL = 'XPTUSDT';
const LAST = Math.floor(NOW / SLOT) * SLOT - 3 * SLOT;
const HOLE = LAST - 100 * SLOT; // a closed-session slot the venue does not publish

function venue(servesHole: () => boolean) {
  return {
    async fetchBackward(q: { endpoint: string }) {
      const rows: unknown[] = [];
      for (let ts = LAST - 2 * 288 * SLOT; ts <= LAST; ts += SLOT) {
        if (ts === HOLE && !servesHole()) continue;
        rows.push(q.endpoint === 'openInterestHist'
          ? { symbol: SYMBOL, sumOpenInterest: '10', sumOpenInterestValue: '20', timestamp: ts }
          : q.endpoint === 'takerlongshortRatio'
            ? { buySellRatio: '1', buyVol: '1', sellVol: '1', timestamp: ts }
            : { symbol: SYMBOL, longShortRatio: '1', longAccount: '0.5', shortAccount: '0.5', timestamp: ts });
      }
      return rows;
    },
    async fetchPage() { return []; },
  } as unknown as FuturesDataClient;
}

maybeDescribe('IB-BUG-020 OI/LS gap ledger against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let servesHole = false;

  const boot = async () => {
    const streams = new StreamRegistry();
    const metrics = new MetricsService(streams);
    const config = { symbols: [{ binance_perp: SYMBOL }], env: { get: () => undefined } } as never;
    const poller = new OiLsPoller(config, db, new PartitionMaintenanceService(db), new Writers(db, metrics),
      new BinanceWeightTracker(), metrics, streams, venue(() => servesHole));
    await poller.backfill(NOW);
    return streams.snapshot(NOW).find((s) => s.id === STREAM_ID)?.gapsOpen;
  };
  const gapRows = () => db.query<{ gap_from: Date; gap_to: Date; expected: number; repaired: number }>(
    'select gap_from, gap_to, expected, repaired from collector_gaps where stream = $1 and symbol = $2', [STREAM_ID, SYMBOL]);

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_gapledger', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    // IB-109: migration 025 seeds five alert-list coins, and the poller collects universe ∪ that list. This
    // spec pins the gap ledger for ITS symbols; the union has its own spec (oi-ls.poller.spec.ts).
    db = new PgDatabase(url.toString());
    await db.query('delete from alert_symbols', []);
    await new PartitionMaintenanceService(db).ensureRange(new Date(NOW - 40 * 86_400_000), new Date(NOW + 86_400_000));
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, listed_perp, active) values ($1, 'XPT', 'USDT', $1, '2026-01-30', true)`,
      [SYMBOL],
    );
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  it('three boots, one hole the venue never serves: ONE row, open on every boot', async () => {
    const open = [await boot(), await boot(), await boot()];
    const rows = await gapRows();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].gap_from).getTime()).toBe(HOLE);
    expect(new Date(rows[0].gap_to).getTime()).toBe(HOLE);
    expect(Number(rows[0].repaired)).toBe(0);
    expect(open).toEqual([1, 1, 1]);
  }, 60_000);

  it('the venue starts serving it: the same row is repaired, no new row, and health shows it closed', async () => {
    servesHole = true;
    const open = await boot();
    const rows = await gapRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].repaired)).toBe(Number(rows[0].expected));
    expect(open).toBe(0);
  }, 60_000);
});
