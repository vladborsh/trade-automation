import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DB_HOOK_TIMEOUT_MS, dropLeftovers, dropOwn, scratchPrefix } from './scratch-db';

/**
 * Migration 002 (BUG-002/003 ruling): the R columns and profit_factor go from numeric(12,6) to
 * numeric(20,6) and back, on a database holding data, with every value preserved. Runs in a
 * throwaway database created next to the slot's own (so the other integration specs, which share
 * the slot database, never see a schema flip mid-run) and dropped afterwards.
 * Skipped without DATABASE_URL:  DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('migration-002.integration.spec.ts: DATABASE_URL not set — skipping the migration 002 up/down test.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const R_COLUMNS: ReadonlyArray<[string, string]> = [
  ['orders', 'pnl_r'],
  ['orders', 'mae_r'],
  ['backtest_sessions', 'pnl_r'],
  ['backtest_sessions', 'max_drawdown_r'],
  ['backtest_sessions', 'avg_win_r'],
  ['backtest_sessions', 'avg_loss_r'],
  ['backtest_sessions', 'profit_factor'],
];

maybeDescribe('migration 002: widen the R columns (up and down, data preserved)', () => {
  // Built in beforeAll, not here: describe.skip still runs this body, and without DATABASE_URL a
  // describe-level `new URL(undefined)` throws and fails the whole suite.
  let name: string;
  let scratchUrl: string;
  let admin: Client;
  let db: PgDatabase;

  // BUG-012: creating and dropping a database can outlast jest's 5 s hook default on a busy
  // Postgres, so both hooks get an explicit timeout (see DB_HOOK_TIMEOUT_MS).
  beforeAll(async () => {
    const prefix = scratchPrefix('backtest_mig', DATABASE_URL as string);
    name = `${prefix}${randomUUID().slice(0, 8)}`;
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${name}`;
    scratchUrl = url.toString();
    admin = new Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await dropLeftovers(admin, prefix); // this slot's leftovers from an earlier failed teardown
    await admin.query(`create database ${name}`);
    db = new PgDatabase(scratchUrl);
  }, DB_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await db.end();
    await dropOwn(async () => admin, [name]); // on the spec's own admin connection, which it then ends
  }, DB_HOOK_TIMEOUT_MS);

  const precisions = async () =>
    (
      await db.query<{ t: string; c: string; p: number; s: number }>(
        `select table_name as t, column_name as c, numeric_precision as p, numeric_scale as s
           from information_schema.columns
          where (table_name, column_name) in (${R_COLUMNS.map(([t, c]) => `('${t}','${c}')`).join(',')})
          order by table_name, column_name`,
      )
    ).map((r) => `${r.t}.${r.c}=${r.p},${r.s}`);
  const values = async () => ({
    order: (await db.query(`select pnl_r, mae_r from orders`))[0],
    session: (await db.query(`select pnl_r, max_drawdown_r, avg_win_r, avg_loss_r, profit_factor from backtest_sessions`))[0],
  });

  it('001 → 002 → 001 with data: precision 12 → 20 → 12, scale 6 throughout, values unchanged', async () => {
    expect((await runMigrations({ connectionString: scratchUrl, target: '001' })).applied.map((m) => m.version)).toEqual([1]);
    expect(new Set((await precisions()).map((p) => p.split('=')[1]))).toEqual(new Set(['12,6']));

    const [user] = await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ('m@x.test', 'x', 'user') returning id`);
    const [session] = await db.query<{ id: string }>(
      `insert into backtest_sessions (user_id, name, status, session_currency, timeframe, period_from_ms, period_to_ms, cursor_ms,
         initial_balance, balance, default_risk_pct, costs_enabled, commission_pct, spread, layout,
         pnl_r, max_drawdown_r, avg_win_r, avg_loss_r, profit_factor)
       values ($1, 's', 'active', 'USD', '1m', 1, 2, 1, 10000, 10000, 1, true, 0.04, 1, '{}',
         999999.123456, 12.5, 3.25, -1.5, 4.607985) returning id`,
      [user.id],
    );
    await db.query(
      `insert into orders (session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, qty, risk_pct, risk_amount_ccy,
         sl_initial, sl_current, pnl_r, mae_r)
       values ($1, 1, 'p', 'binance:BTCUSDT', 'long', 'market', 'closed', 1, 1, 1, 100, 90, 90, -999999.999999, 0.069856)`,
      [session.id],
    );
    const before = await values();

    await runMigrations({ connectionString: scratchUrl }); // up to latest (002)
    expect(new Set((await precisions()).map((p) => p.split('=')[1]))).toEqual(new Set(['20,6']));
    expect(await values()).toEqual(before);

    // a value the old columns could not hold now fits
    await db.query(`update orders set pnl_r = 1399500.123456`);
    expect((await db.query<{ pnl_r: number }>(`select pnl_r from orders`))[0].pnl_r).toBe(1399500.123456);
    await db.query(`update orders set pnl_r = -999999.999999`);

    await runMigrations({ connectionString: scratchUrl, target: '001' }); // down again
    expect(new Set((await precisions()).map((p) => p.split('=')[1]))).toEqual(new Set(['12,6']));
    expect(await values()).toEqual(before);
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: three migration runs on a fresh database — 5 s is not enough on a loaded Postgres
});
