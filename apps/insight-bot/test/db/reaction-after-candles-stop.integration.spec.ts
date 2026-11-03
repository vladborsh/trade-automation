import { randomUUID } from 'crypto';
import { Client } from 'pg';
import type { BinanceRestKline } from '@trade-automation/binance-client';
import type { AppConfigService } from '../../src/config/config.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { ReactionService } from '../../src/news/reaction.service';
import { BinanceWeightTracker } from '../../src/venues/binance/binance-weight.tracker';
import type { PerpRest } from '../../src/venues/binance/perp.rest';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * WD-010 stopped writing `candles_1m`; under the news hold every reaction after that refused
 * `window_not_covered` (this file pinned it). IB-097 (storage ruling S8) moves the price to on-demand
 * Binance klines, so this file now pins the NEW path:
 *
 * - a story AFTER the tape stopped is measured, from the venue;
 * - the old tape is not read at all. Since WD-006 (migration 024) the table does not even exist, so a
 *   read of it would throw and fail this file. (Until 024 this spec kept the tape, priced flat, under
 *   both stories, to show the numbers did not come from it.)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-after-candles-stop.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;
/** The tape stopped here, as it did on the box at the WD-010 deploy. */
const LAST_CANDLE = DAY + 299 * MIN;
const config = { symbols: [{ id: 'BTCUSDT', binance_perp: 'BTCUSDT' }] } as unknown as AppConfigService;
const venuePrice = (t: number) => 100 * 1.001 ** ((t - DAY) / MIN);

const venue = {
  klinesRange: async (_symbol: string, startTime: number, endTime: number, limit: number): Promise<BinanceRestKline[]> => {
    const rows: BinanceRestKline[] = [];
    for (let t = startTime; t <= endTime && rows.length < limit; t += MIN) {
      const c = String(venuePrice(t));
      rows.push([t, c, c, c, c, '1', t + MIN - 1, '1', 1, '0.5', '0.5', '0']);
    }
    return rows;
  },
} as unknown as PerpRest;

maybeDescribe('IB-097: news reactions after candles_1m stopped are measured from the venue, never the tape', () => {
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

    const story = async (id: string, at: number) => {
      await db.query(
        `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
         values ($1,'decrypt',$2,'BTC moves',$3,$3,$4,$5)`,
        [id, `https://x/${id}`, new Date(at), `u-${id}`, `t-${id}`],
      );
      await db.query(`insert into news_assets (news_id, symbol, via, matched) values ($1,'BTCUSDT','ticker','BTC')`, [id]);
    };
    await story('inside', DAY + 10 * MIN); // inside the old tape's hours
    await story('after', LAST_CANDLE + 61 * MIN); // an hour after the last stored candle

    await new ReactionService(db, venue, new BinanceWeightTracker(), config).tick(DAY + 12 * 3_600_000);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  const rows = async (id: string) =>
    db.query<{ horizon: string; return_pct: string | null; refused: string | null }>(
      `select horizon, return_pct, refused from news_reactions where news_id = $1 order by horizon`, [id],
    );
  const minutes: Record<string, number> = { '15m': 15, '1h': 60, '4h': 240 };

  it('the tape table is gone (WD-006): a read of it could only throw', async () => {
    const [r] = await db.query<{ t: string | null }>(`select to_regclass('public.candles_1m')::text as t`, []);
    expect(r.t).toBeNull();
  });

  it('a story after the last candle: every horizon is MEASURED from the venue (it used to refuse)', async () => {
    const r = await rows('after');
    expect(r.map((x) => x.horizon).sort()).toEqual(['15m', '1h', '4h']);
    for (const reaction of r) {
      expect(reaction.refused).toBeNull();
      expect(Number(reaction.return_pct)).toBeCloseTo((1.001 ** minutes[reaction.horizon] - 1) * 100, 6);
    }
  });

  it('a story inside the old tape\'s hours is priced from the venue too', async () => {
    for (const reaction of await rows('inside')) {
      expect(reaction.refused).toBeNull();
      expect(Number(reaction.return_pct)).toBeCloseTo((1.001 ** minutes[reaction.horizon] - 1) * 100, 6);
    }
  });
});
