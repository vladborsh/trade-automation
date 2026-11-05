import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { OI_DIVERGENCE_DEFAULT_PARAMS, OiDivergenceParamsSchema } from '@trade-automation/contracts';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { PgOiAlertStore } from '../../src/alerts/oi-divergence/pg/oi-alerts.repo';
import { PgBackfillReads } from '../../src/alerts/oi-divergence/pg/backfill-reads';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * IB-144 — migration 033 (architecture/oi-divergence-design-2026-11-04.md V41, V42) on a database just before it:
 * - every existing journal / near-miss row reads `kind = 'regular'`; the column then has NO default (a writer must say);
 * - the once-keys include kind: the same (source, symbol, tf, direction, A, B) as regular and hidden are two rows, a
 *   second hidden one is absorbed; a near-miss per B per kind;
 * - alert_settings gains `sendHidden: false` on every TF — the end of the chain equals OI_DIVERGENCE_DEFAULT_PARAMS — and
 *   an owner's value already there is kept; updated_by / updated_at untouched;
 * - `hasAlert` filters by kind (a hidden alert does not answer «regular alert at B»), `hiddenEnd` reads the first live
 *   control whose params carry the key;
 * - undo removes the hidden rows and the switch; 033 re-applies.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-033.integration.spec.ts: DATABASE_URL not set — skipping.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const BEFORE = '032';
const T0 = new Date(Date.UTC(2026, 10, 1, 12));
const T1 = new Date(Date.UTC(2026, 10, 2, 12));
const PRE = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { '15m': { nLeft: 6, nRight: 6, k: 3, w: 96 }, '1h': { nLeft: 6, nRight: 6, k: 3, w: 168 }, '4h': { nLeft: 6, nRight: 2, k: 3, w: 90 } } };

maybeDescribe('IB-144 migration 033: kind on the journal and near-misses, sendHidden per TF', () => {
  let admin: Client;
  const made: string[] = [];
  let prefix: string;

  async function before033(): Promise<{ db: PgDatabase; url: string }> {
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
  const alertSql = (kind: string | null) => `insert into oi_divergence_alerts
      (source, symbol, tf, direction, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at, build${kind === null ? '' : ', kind'})
    values ('live', 'ETHUSDT', '1h', 'bullish', $1, 100, $1, 1000, $2, 102, $2, 950, '{}'::jsonb, $2, 'caa595788ec0'${kind === null ? '' : `, '${kind}'`})
    on conflict on constraint oi_divergence_alerts_once do nothing returning id`;
  const nearMissSql = (kind: string) => `insert into oi_divergence_near_misses
      (source, symbol, tf, direction, kind, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, rule, miss, unit, params, confirmed_at, build)
    values ('live', 'ETHUSDT', '1h', 'bullish', '${kind}', $1, 100, $1, 1000, $2, 102, $2, 950, 'oi_delta', 0.3, 'threshold', '{}'::jsonb, $2, 'caa595788ec0')
    on conflict on constraint oi_divergence_near_misses_once do nothing returning id`;

  beforeAll(async () => {
    prefix = scratchPrefix('insight_m033', DATABASE_URL as string);
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

  it('existing rows read regular; afterwards the column has no default and a hidden twin of a regular row is its own row', async () => {
    const { db, url } = await before033();
    try {
      expect(await db.query(alertSql(null), [T0, T1])).toHaveLength(1); // 032's shape: no kind column yet
      await runMigrations({ connectionString: url });
      expect(await db.query<{ kind: string }>('select kind from oi_divergence_alerts', [])).toEqual([{ kind: 'regular' }]);
      await expect(db.query(alertSql(null), [T0, T1])).rejects.toThrow(/null value in column "kind"/);
      expect(await db.query(alertSql('hidden'), [T0, T1])).toHaveLength(1); // same A and B, the other kind
      expect(await db.query(alertSql('hidden'), [T0, T1])).toHaveLength(0); // once-key absorbs the second
      await expect(db.query(alertSql('reverse'), [T0, T1])).rejects.toThrow(/check constraint/);
      expect(await db.query(nearMissSql('regular'), [T0, T1])).toHaveLength(1);
      expect(await db.query(nearMissSql('hidden'), [T0, T1])).toHaveLength(1); // one per B per kind
      expect(await db.query(nearMissSql('hidden'), [T0, T1])).toHaveLength(0);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('an untouched settings row ends the chain EQUAL to the defaults (sendHidden false everywhere); updated_by / updated_at untouched', async () => {
    const { db, url } = await before033();
    try {
      expect(await params(db)).toEqual(PRE); // the base really lacks the key, so 033 is what adds it
      const [was] = await db.query<{ updated_by: number | null; updated_at: Date }>('select updated_by, updated_at from alert_settings where id = 1', []);
      await runMigrations({ connectionString: url });
      const after = await params(db);
      expect(after).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
      expect(OiDivergenceParamsSchema.safeParse(after).success).toBe(true);
      expect(await db.query('select updated_by, updated_at from alert_settings where id = 1', [])).toEqual([was]);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('a sendHidden already in the row is kept (a re-run cannot clobber the guard’s switch); the other TFs get false', async () => {
    const { db, url } = await before033();
    try {
      await db.query(`update alert_settings set params = jsonb_set(params, '{perTf,1h,sendHidden}', 'true') where id = 1`, []);
      await runMigrations({ connectionString: url });
      const p = OiDivergenceParamsSchema.parse(await params(db));
      expect([p.perTf['15m'].sendHidden, p.perTf['1h'].sendHidden, p.perTf['4h'].sendHidden]).toEqual([false, true, false]);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('the repo: hasAlert is per kind; hiddenEnd is the first LIVE control whose params carry sendHidden', async () => {
    const { db, url } = await before033();
    try {
      await runMigrations({ connectionString: url });
      await db.query(alertSql('hidden'), [T0, T1]);
      const store = new PgOiAlertStore(db);
      const b = Math.floor(T1.getTime() / 1000);
      expect(await store.hasAlert('live', 'ETHUSDT', '1h', 'hidden', 'bullish', b)).toBe(true);
      expect(await store.hasAlert('live', 'ETHUSDT', '1h', 'regular', 'bullish', b)).toBe(false); // a control is not removed by it
      const reads = new PgBackfillReads(db);
      expect(await reads.hasLive('alert', 'ETHUSDT', '1h', 'hidden', 'bullish', b)).toBe(true);
      expect(await reads.hasLive('alert', 'ETHUSDT', '1h', 'regular', 'bullish', b)).toBe(false);
      const control = (at: string, p: unknown) => db.query(
        `insert into oi_divergence_controls (source, symbol, tf, kind, direction, bar_time, params, build, created_at)
         values ('live', 'ETHUSDT', '1h', 'random', null, $1, $2, 'caa595788ec0', $1)`, [at, JSON.stringify(p)]);
      await control('2026-11-05T10:00:00Z', PRE); // the old image: no key
      expect(await reads.hiddenEnd('ETHUSDT', '1h')).toBeNull();
      await control('2026-11-06T01:00:00Z', OI_DIVERGENCE_DEFAULT_PARAMS);
      await control('2026-11-06T03:00:00Z', OI_DIVERGENCE_DEFAULT_PARAMS);
      expect(await reads.hiddenEnd('ETHUSDT', '1h')).toBe(Date.UTC(2026, 10, 6, 1) / 1000);
      expect(await reads.hiddenEnd('ETHUSDT', '4h')).toBeNull(); // per pair
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);

  it('undo removes hidden rows (a repeat first) and the switch, keeps regular rows; 033 re-applies', async () => {
    const { db, url } = await before033();
    try {
      await runMigrations({ connectionString: url });
      await db.query(alertSql('regular'), [T0, T1]);
      const [{ id: first }] = await db.query<{ id: string }>(alertSql('hidden'), [T0, T1]);
      await db.query(`insert into oi_divergence_alerts
          (source, symbol, tf, direction, kind, a_time, a_price, a_oi_time, a_oi, b_time, b_price, b_oi_time, b_oi, params, confirmed_at, build, run_of, run_length)
        values ('live', 'ETHUSDT', '1h', 'bullish', 'hidden', $1, 100, $1, 1000, $2, 103, $2, 940, '{}'::jsonb, $2, 'caa595788ec0', $3, 3)`,
      [T0, new Date(T1.getTime() + 3_600_000), first]);
      await runMigrations({ connectionString: url, target: BEFORE });
      expect(await db.query('select count(*)::int as n from oi_divergence_alerts', [])).toEqual([{ n: 1 }]);
      expect(await params(db)).toEqual(PRE);
      await runMigrations({ connectionString: url });
      expect(await params(db)).toEqual(OI_DIVERGENCE_DEFAULT_PARAMS);
    } finally {
      await db.end();
    }
  }, DB_HOOK_TIMEOUT_MS);
});
