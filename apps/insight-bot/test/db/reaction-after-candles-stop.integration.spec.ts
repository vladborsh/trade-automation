import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import type { AppConfigService } from '../../src/config/config.service';
import { closeAtOrBefore } from '../../src/db/pg/reaction-reads';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { ReactionService } from '../../src/news/reaction.service';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * WD-010 + the news hold (Tech Lead decision (c), 2026-11-03). WD-010 stops writing `candles_1m`;
 * news stays, and its reactions read `candles_1m`. The condition: a story AFTER the last stored
 * candle must get an explicit refusal for every horizon — never a number computed from the old
 * rows (an older close IS still there, which is exactly the trap), and never 0.
 *
 * Positive control in the same database: a story inside the candles is still measured, so a job
 * that refuses everything cannot pass this file.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-after-candles-stop.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;
/** The tape stops here, as it will on the box at the WD-010 deploy. */
const LAST_CANDLE = DAY + 299 * MIN;
const config = { symbols: [{ id: 'BTCUSDT', binance_perp: 'BTCUSDT' }] } as unknown as AppConfigService;

maybeDescribe('news reactions after candles_1m stops (WD-010, news hold)', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_rxstop', DATABASE_URL as string);
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

    // five hours of 1m bars (00:00 … 04:59), then nothing — the collector is gone
    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    await candles.write(Array.from({ length: 300 }, (_, i) => {
      const close = 100 * 1.001 ** i;
      return {
        venue: 'binance', market: 'perp' as const, symbol: 'BTCUSDT', openTime: new Date(DAY + i * MIN),
        open: close, high: close, low: close, close, volume: 1, source: 'archive' as const,
      };
    }));

    const story = async (id: string, at: number) => {
      await db.query(
        `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
         values ($1,'decrypt',$2,'BTC moves',$3,$3,$4,$5)`,
        [id, `https://x/${id}`, new Date(at), `u-${id}`, `t-${id}`],
      );
      await db.query(`insert into news_assets (news_id, symbol, via, matched) values ($1,'BTCUSDT','ticker','BTC')`, [id]);
    };
    await story('before', DAY + 10 * MIN); // inside the tape: the positive control
    await story('after', LAST_CANDLE + 61 * MIN); // an hour after the last candle

    // "now" is well past every horizon of both stories
    await new ReactionService(db, config).tick(DAY + 12 * 3_600_000);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const rows = async (id: string) =>
    db.query<{ horizon: string; return_pct: string | null; refused: string | null }>(
      `select horizon, return_pct, refused from news_reactions where news_id = $1 order by horizon`, [id],
    );

  it('the trap is real: an older close IS available for a time after the last candle', async () => {
    const stale = await closeAtOrBefore(db, { venue: 'binance', market: 'perp', spelling: 'BTCUSDT' } as never, new Date(LAST_CANDLE + 61 * MIN));
    expect(stale).not.toBeNull(); // a naive "close at or before" would happily price the story from it
  });

  it('a story after the last candle: every horizon is an explicit refusal — no number, never 0', async () => {
    const r = await rows('after');
    expect(r.map((x) => x.horizon).sort()).toEqual(['15m', '1h', '4h']);
    for (const reaction of r) {
      expect(reaction.refused).toBe('window_not_covered');
      expect(reaction.return_pct).toBeNull();
    }
  });

  it('the positive control: a story inside the tape is still measured', async () => {
    const r = await rows('before');
    const m15 = r.find((x) => x.horizon === '15m')!;
    expect(m15.refused).toBeNull();
    expect(Number(m15.return_pct)).toBeCloseTo((1.001 ** 15 - 1) * 100, 6);
  });
});
