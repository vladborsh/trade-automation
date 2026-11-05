import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS, OiDivergenceJournalParamsSchema, OiDivergenceParamsSchema } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-141 — migration 032 (architecture/oi-divergence-design-2026-11-04.md V34) on a database just before it:
 * - an untouched row ends the chain EQUAL to the contracts' defaults (15m 6/6, 1h 6/6, 4h 6/2) and parses strictly;
 * - an owner's edit survives as a symmetric pair: 4h n = 5 becomes 5/5 (only 4h n = 6 becomes 6/2), 1h n = 8 → 8/8;
 * - journal rows are not touched, and one with `n` reads as nLeft = nRight = n;
 * - undo returns an untouched row to one n per TF; 032 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-032.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

/** The last migration before 032 on master (031 is IB-122's market_alerts; 030 on a tree without it). */
const BEFORE = '030';
const ONE_N = {
  perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 168 }, '4h': { n: 6, k: 3, w: 90 } },
  atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5,
};
const T0 = new Date(Date.UTC(2026, 10, 1, 12));
const T1 = new Date(Date.UTC(2026, 10, 2, 12));

maybeDescribe('IB-141 migration 032: N splits into nLeft / nRight in alert_settings', () => {
  let admin: Client;
  const made: string[] = [];
  let prefix: string;

  async function before032(): Promise<{ db: PgDatabase; url: string }> {
    const name = `${prefix}${randomUUID().slice(0, 8)}`;
    made.push(name);
    await admin.query(`create database ${name}`);
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    await runMigrations({ connectionString: u.toString(), target: BEFORE });
    return { db: new PgDatabase(u.toString()), url: u.toString() };
  }
  const params = async (db: PgDatabase): Promise<unknown> =>
    (await db.query<{ params: unknown }>('select params from alert_settings where id = 1', []))[0].params;

  beforeAll(async () => {
    prefix = scratchPrefix('insight_m032', DATABASE_URL as string);
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await admin.end();
    await dropOwn(async () => {
      const c = new Client({ connectionString: DATABASE_URL });
      await c.connect();
      return c;
    }, made);
  }, DB_HOOK_TIMEOUT_MS);

  it('an untouched row: one n per TF before, and the end of the chain equals OI_DIVERGENCE_DEFAULT_PARAMS (4h 6/2)', async () => {
    const { db, url } = await before032();
    try {
      expect(await params(db)).toEqual(ONE_N); // the base really has one n, so 032 is what moves it
      await runMigrations({ connectionString: url });
      const after = await params(db);
      expect(after).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
      expect(OiDivergenceParamsSchema.safeParse(after).success).toBe(true);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('the owner’s edits survive as symmetric pairs: an edited 4h n = 5 becomes 5/5, 1h n = 8 becomes 8/8; k, W and the rest kept', async () => {
    const { db, url } = await before032();
    try {
      await db.query(
        `update alert_settings set params = jsonb_set(jsonb_set(params, '{perTf,4h,n}', '5'), '{perTf,1h}', '{"n":8,"k":2,"w":150}') where id = 1`, []);
      await runMigrations({ connectionString: url });
      expect(await params(db)).toEqual({
        ...OI_DIVERGENCE_DEFAULT_PARAMS,
        perTf: { '15m': { nLeft: 6, nRight: 6, k: 3, w: 96 }, '1h': { nLeft: 8, nRight: 8, k: 2, w: 150 }, '4h': { nLeft: 5, nRight: 5, k: 3, w: 90 } },
      });
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('only 4h moves to 2 on the right: a 15m or 1h n = 6 stays 6/6 (mutation: the TF guard dropped)', async () => {
    const { db, url } = await before032();
    try {
      await runMigrations({ connectionString: url });
      const p = OiDivergenceParamsSchema.parse(await params(db));
      expect([p.perTf['15m'].nRight, p.perTf['1h'].nRight, p.perTf['4h'].nRight]).toEqual([6, 6, 2]);
      expect([p.perTf['15m'].nLeft, p.perTf['1h'].nLeft, p.perTf['4h'].nLeft]).toEqual([6, 6, 6]);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('journal rows are not touched, and one with n reads as nLeft = nRight = n (V34)', async () => {
    const { db, url } = await before032();
    try {
      await db.query(
        `insert into oi_divergence_alerts (source, symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at, build)
         values ('live', 'ETHUSDT', '4h', 'bearish', $1, 100, $1, 1000, $2, 102, $2, 950, $3, $2, 'caa595788ec0')`, [T0, T1, JSON.stringify(ONE_N)]);
      await runMigrations({ connectionString: url });
      const [r] = await db.query<{ params: unknown }>('select params from oi_divergence_alerts', []);
      expect(r.params).toEqual(ONE_N);
      expect(OiDivergenceJournalParamsSchema.parse(r.params).perTf['4h']).toEqual({ nLeft: 6, nRight: 6, k: 3, w: 90 });
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('undo returns an untouched row to one n per TF (4h back to 6); 032 re-applies', async () => {
    const { db, url } = await before032();
    try {
      await runMigrations({ connectionString: url });
      await runMigrations({ connectionString: url, target: BEFORE });
      expect(await params(db)).toEqual(ONE_N);
      await runMigrations({ connectionString: url });
      expect(await params(db)).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);
});
