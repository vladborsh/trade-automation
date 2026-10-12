import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import type { AppConfigService } from '../../src/config/config.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { ReactionService } from '../../src/news/reaction.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-027 — the reaction job end to end.
 *
 * **Positive control (IB-027 rule).** A job that refuses everything would pass every refusal test,
 * so the first case here MUST produce a number from real candles.
 *
 * The property the review asked for is the second: a window that has not closed must be refused and
 * then REPLACED by a measurement once it closes — never measured early, and never left as a refusal
 * that time has since resolved.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-service.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;
const config = { symbols: [{ id: 'BTCUSDT', binance_perp: 'BTCUSDT' }] } as unknown as AppConfigService;

maybeDescribe('IB-027 reaction job against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;
  let service: ReactionService;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_rxjob', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
    await admin.query(`create database ${name}`);
    await runMigrations({ connectionString: url.toString() });
    db = new PgDatabase(url.toString());
    await new PartitionMaintenanceService(db).ensureRange(new Date(DAY), new Date(DAY + 2 * 86_400_000));
    service = new ReactionService(db, config);

    // five hours of 1m bars, rising 0.1 % a minute, so every horizon has a real move to find
    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    await candles.write(Array.from({ length: 300 }, (_, i) => {
      const close = 100 * 1.001 ** i;
      return {
        venue: 'binance', market: 'perp' as const, symbol: 'BTCUSDT', openTime: new Date(DAY + i * MIN),
        open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5, source: 'archive' as const,
      };
    }));

    // one tagged story, first seen at DAY + 10m
    await db.query(
      `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
       values ('n1','decrypt','https://x/n1','BTC moves',$1,$1,'u1','t1')`,
      [new Date(DAY + 10 * MIN)],
    );
    await db.query(`insert into news_assets (news_id, symbol, via, matched) values ('n1','BTCUSDT','ticker','BTC')`, []);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const row = async (horizon: string) =>
    (await db.query<{ return_pct: number | null; refused: string | null; venue: string; market: string; symbol_spelling: string; anchor: string; others_in_window: number; of_window_items: number }>(
      `select return_pct, refused, venue, market, symbol_spelling, anchor, others_in_window, of_window_items
         from news_reactions where news_id = 'n1' and horizon = $1`, [horizon],
    ))[0];

  it('measures a closed window from real candles — the positive control', async () => {
    // "now" is well past every horizon
    await service.tick(DAY + 10 * 3_600_000);

    const r = await row('15m');
    expect(r.refused).toBeNull();
    // 15 minutes at +0.1 %/min compounding ≈ +1.51 %
    expect(Number(r.return_pct)).toBeCloseTo((1.001 ** 15 - 1) * 100, 6);
    // and the row says where the price came from
    expect(r.venue).toBe('binance');
    expect(r.market).toBe('perp');
    expect(r.symbol_spelling).toBe('BTCUSDT');
    expect(r.anchor).toBe('first_seen');
    expect(Number(r.of_window_items)).toBe(1);
  });

  it('refuses a window that has not closed, then REPLACES it once it has', async () => {
    await db.query(`delete from news_reactions where news_id = 'n1'`, []);

    // now = five minutes after first sight: the 15m window is still open
    await service.tick(DAY + 15 * MIN);
    const open = await row('15m');
    expect(open.refused).toBe('window_not_closed');
    expect(open.return_pct).toBeNull();

    // the same job later, with the window closed: the refusal is replaced by a measurement
    await service.tick(DAY + 10 * 3_600_000);
    const closed = await row('15m');
    expect(closed.refused).toBeNull();
    expect(Number(closed.return_pct)).toBeGreaterThan(0);
  });

  it('refuses rather than measuring when the price series has a hole in the window', async () => {
    await db.query(`delete from news_reactions where news_id = 'n1'`, []);
    await db.query(
      `delete from candles_1m where venue='binance' and symbol='BTCUSDT' and open_time >= $1 and open_time < $2`,
      // minutes 30-34: inside the 1h window (10 -> 70) and outside the 15m one (10 -> 25)
      [new Date(DAY + 30 * MIN), new Date(DAY + 35 * MIN)],
    );

    await service.tick(DAY + 10 * 3_600_000);
    const r = await row('1h');
    expect(r.refused).toBe('window_not_covered');
    expect(r.return_pct).toBeNull();
    // the 15m window ended before the hole, so it is still measurable — the refusal is scoped to
    // the window that actually contains the gap, not to the symbol
    expect((await row('15m')).refused).toBeNull();
  });
});
