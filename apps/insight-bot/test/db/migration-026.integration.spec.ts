import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS, OiDivergenceJournalParamsSchema, OiDivergenceParamsSchema } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-114 — migration 026 (architecture/oi-divergence-design-2026-11-04.md V19, V20) on a database at 025:
 * - an untouched row ends the chain EQUAL to the contracts' defaults, and parses with the strict schema;
 * - a value the owner set on /admin/alerts (a 1h W other than 120, a tolerance already present) survives 026;
 * - journal rows are not touched, and read as tolerance 0 (V20);
 * - undo returns the untouched row to 025's seed, and 026 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-026.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const ROUND_1_SEED = {
  perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 120 }, '4h': { n: 6, k: 3, w: 90 } },
  atrMult: 0.25,
  oiMedianMult: 0.5,
};
const T0 = new Date(Date.UTC(2026, 10, 1, 12));
const T1 = new Date(Date.UTC(2026, 10, 2, 12));

maybeDescribe('IB-114 migration 026: line tolerances and 1h W 168 in alert_settings', () => {
  let admin: Client;
  const made: string[] = [];
  let prefix: string;

  /** A fresh database at 025, optionally edited as the owner would, then taken to the end of the chain. */
  async function at025(): Promise<{ db: PgDatabase; url: string }> {
    const name = `${prefix}${randomUUID().slice(0, 8)}`;
    made.push(name);
    await admin.query(`create database ${name}`);
    const u = new URL(DATABASE_URL as string);
    u.pathname = `/${name}`;
    await runMigrations({ connectionString: u.toString(), target: '025' });
    return { db: new PgDatabase(u.toString()), url: u.toString() };
  }
  const params = async (db: PgDatabase): Promise<unknown> =>
    (await db.query<{ params: unknown }>('select params from alert_settings where id = 1', []))[0].params;

  beforeAll(async () => {
    prefix = scratchPrefix('insight_m026', DATABASE_URL as string);
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await admin.end();
    await dropOwn(async () => { // one connection per database: dropOwn ends each one it is given
      const c = new Client({ connectionString: DATABASE_URL });
      await c.connect();
      return c;
    }, made);
  }, DB_HOOK_TIMEOUT_MS);

  it('an untouched row: 025 seeds round 1, and the end of the chain equals OI_DIVERGENCE_DEFAULT_PARAMS', async () => {
    const { db, url } = await at025();
    try {
      expect(await params(db)).toEqual(ROUND_1_SEED); // the base really is round 1, so 026 is what moves it
      await runMigrations({ connectionString: url });
      const after = await params(db);
      expect(after).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
      expect(OiDivergenceParamsSchema.safeParse(after).success).toBe(true); // the strict schema: the chart no longer falls back
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('the owner’s edits survive: a 1h W other than 120 and a tolerance already present are kept', async () => {
    const { db, url } = await at025();
    try {
      await db.query(
        `update alert_settings set params = jsonb_set(params, '{perTf,1h,w}', '150') || '{"priceLineTolAtrMult":0.4}'::jsonb where id = 1`, []);
      await runMigrations({ connectionString: url, target: '026' }); // 026's own effect; 032 then splits N (its own spec)
      expect(await params(db)).toEqual({
        ...ROUND_1_SEED,
        perTf: { ...ROUND_1_SEED.perTf, '1h': { n: 6, k: 3, w: 150 } },
        priceLineTolAtrMult: 0.4, // the owner's, not 026's 0.25
        oiLineTolMedianMult: 0.5, // absent → added
      });
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('journal rows are not touched, and one from before 026 reads as tolerance 0 (V20)', async () => {
    const { db, url } = await at025();
    try {
      await db.query(
        `insert into oi_divergence_alerts (symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at)
         values ('BTCUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 98, $2, 1050, $3, $2)`, [T0, T1, JSON.stringify(ROUND_1_SEED)]);
      await runMigrations({ connectionString: url });
      const [r] = await db.query<{ params: unknown }>('select params from oi_divergence_alerts', []);
      expect(r.params).toEqual(ROUND_1_SEED);
      const n6 = (w: number) => ({ nLeft: 6, nRight: 6, k: 3, w, sendHidden: false }); // and 033's switch, absent → off // V34: a row with one n reads as both sides
      expect(OiDivergenceJournalParamsSchema.parse(r.params)).toEqual({
        ...ROUND_1_SEED, perTf: { '15m': n6(96), '1h': n6(120), '4h': n6(90) }, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0,
      });
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('undo returns an untouched row to 025’s seed; 026 re-applies', async () => {
    const { db, url } = await at025();
    try {
      await runMigrations({ connectionString: url });
      await runMigrations({ connectionString: url, target: '025' });
      expect(await params(db)).toEqual(ROUND_1_SEED);
      await runMigrations({ connectionString: url });
      expect(await params(db)).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);
});
