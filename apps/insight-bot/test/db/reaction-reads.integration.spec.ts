import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { BatchWriter } from '../../src/collectors/writers/batch-writer';
import * as t from '../../src/collectors/writers/tables';
import { runMigrations } from '../../src/db/migration-runner';
import { PartitionMaintenanceService } from '../../src/db/partitions.service';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { closeAtOrBefore, othersInWindow, windowCoverage, type PriceScope } from '../../src/db/pg/reaction-reads';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-027 — the reaction reads against a real Postgres.
 *
 * **Positive control (IB-027 rule).** Every check here has a case that MUST find data as well as
 * one that must not: a read that returns nothing for everything passes all the negative tests.
 *
 * The property that needs a real database rather than a fake is the one the review asked for —
 * coverage is per VENUE and MARKET. A window whole on one venue must not vouch for another, and
 * that is a claim about SQL predicates, not about TypeScript.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-reads.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;
const BYBIT: PriceScope = { venue: 'bybit', market: 'perp', spelling: 'BTCUSDT' };
const OKX: PriceScope = { venue: 'okx', market: 'perp', spelling: 'BTC-USDT-SWAP' };

maybeDescribe('IB-027 reaction reads against a real database', () => {
  let name: string;
  let admin: Client;
  let db: PgDatabase;

  beforeAll(async () => {
    const prefix = scratchPrefix('insight_reaction', DATABASE_URL as string);
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

    const candles = new BatchWriter<t.Candle1mRow>(db, t.CANDLES_1M, t.candle1mTuple);
    // bybit: a whole hour. okx: the same hour with ten minutes missing in the middle.
    const bar = (venue: string, symbol: string, i: number, close: number) => ({
      venue, market: 'perp' as const, symbol, openTime: new Date(DAY + i * MIN),
      open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5, source: 'archive' as const,
    });
    await candles.write(Array.from({ length: 60 }, (_, i) => bar('bybit', 'BTCUSDT', i, 100 + i)));
    await candles.write(
      Array.from({ length: 60 }, (_, i) => i).filter((i) => i < 20 || i >= 30)
        .map((i) => bar('okx', 'BTC-USDT-SWAP', i, 200 + i)),
    );
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

  describe('coverage is per venue and market', () => {
    it('finds a whole window whole — the positive control', async () => {
      const c = await windowCoverage(db, BYBIT, new Date(DAY), new Date(DAY + 60 * MIN));
      expect(c).toEqual({ present: 60, expected: 60, covered: true });
    });

    it('does NOT let one venue vouch for another over the same window', async () => {
      // the «все биржи» error at one remove: the hour is whole on bybit and holed on okx, and a
      // reaction measured on okx must see the hole
      const okx = await windowCoverage(db, OKX, new Date(DAY), new Date(DAY + 60 * MIN));
      expect(okx.present).toBe(50);
      expect(okx.covered).toBe(false);
    });

    it('does not let one MARKET vouch for another', async () => {
      // spot holds nothing at all here; a perp-covered window must not pass for spot
      const spot = await windowCoverage(db, { ...BYBIT, market: 'spot' }, new Date(DAY), new Date(DAY + 60 * MIN));
      expect(spot.covered).toBe(false);
      expect(spot.present).toBe(0);
    });

    it('refuses a zero-width window rather than calling it covered', async () => {
      // present >= expected would be trivially true at 0 >= 0, which would wave through a window
      // that measures nothing
      const empty = await windowCoverage(db, BYBIT, new Date(DAY), new Date(DAY));
      expect(empty.covered).toBe(false);
    });
  });

  describe('the price at an instant', () => {
    it('takes the bar at or BEFORE the anchor, never the one after', async () => {
      // anchored 30 seconds into the 12th minute: the 12th bar is the last one closed, and using
      // the 13th would put part of the move being measured into the "before" price
      const price = await closeAtOrBefore(db, BYBIT, new Date(DAY + 12 * MIN + 30_000));
      expect(price).toBe(112);
    });

    it('is null before the series begins', async () => {
      expect(await closeAtOrBefore(db, BYBIT, new Date(DAY - MIN))).toBeNull();
    });

    it('reads the venue it was asked for, not whichever matches the symbol', async () => {
      expect(await closeAtOrBefore(db, OKX, new Date(DAY + 5 * MIN))).toBe(205);
    });
  });

  describe('confounding stories in the window', () => {
    it('counts other tagged items and excludes the story itself', async () => {
      const mk = async (id: string, minute: number) => {
        await db.query(
          `insert into raw_news (id, source, url, title, published_at, fetched_at, url_hash, title_hash)
           values ($1,'decrypt',$2,'t',$3,$3,$4,$5)`,
          [id, `https://x/${id}`, new Date(DAY + minute * MIN), `u${id}`, `t${id}`],
        );
        await db.query(`insert into news_assets (news_id, symbol, via, matched) values ($1,'BTCUSDT','ticker','BTC')`, [id]);
      };
      await mk('a', 5);
      await mk('b', 10);
      await mk('c', 50); // outside a 30-minute window from DAY

      const n = await othersInWindow(db, 'BTCUSDT', 'a', new Date(DAY), new Date(DAY + 30 * MIN));
      expect(n).toBe(1); // 'b' only: 'a' is itself and 'c' is outside
    });

    it('is zero for an uncontested window — and that is a real zero, not an empty read', async () => {
      const n = await othersInWindow(db, 'BTCUSDT', 'a', new Date(DAY + 100 * MIN), new Date(DAY + 130 * MIN));
      expect(n).toBe(0);
    });
  });
});
