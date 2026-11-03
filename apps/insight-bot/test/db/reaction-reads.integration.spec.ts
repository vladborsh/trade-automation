import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { othersInWindow } from '../../src/db/pg/reaction-reads';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-027 — the reaction reads against a real Postgres.
 *
 * **Positive control (IB-027 rule).** Every check here has a case that MUST find data as well as
 * one that must not: a read that returns nothing for everything passes all the negative tests.
 *
 * IB-097: the price and coverage reads left this file with `candles_1m`. They are pure functions
 * over fetched klines now, specced in test/news/reaction-prices.spec.ts, with this file's old cases
 * carried over. Per-venue scoping is now a property of the request (one venue spelling per call,
 * test/db/reaction-service.integration.spec.ts). What remains is the news-only SQL.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('reaction-reads.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const DAY = Date.UTC(2026, 5, 1);
const MIN = 60_000;

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
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]);
  }, DB_HOOK_TIMEOUT_MS);

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
