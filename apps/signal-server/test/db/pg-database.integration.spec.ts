import { randomUUID } from 'crypto';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { runMigrations } from '../../src/db/migration-runner';
import { DB_HOOK_TIMEOUT_MS } from './scratch-db';

/**
 * architecture/backtest-app-system-design.md T-004 "done when" — proves transaction rollback
 * and cascade delete session -> orders -> modifications against a real Postgres. Skipped
 * (loudly, via console.warn) when DATABASE_URL is unset, per the task spec — this is the only
 * test in the suite that talks to a real database.
 *
 * Point DATABASE_URL at your own slot's database, never another slot's:
 *   DATABASE_URL=postgresql://backtest:backtest@localhost:5432/backtest_dev3 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    'pg-database.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres DB tests. ' +
      'Set DATABASE_URL to a local Postgres (your own slot database) to run them.',
  );
}

const maybeDescribe = DATABASE_URL ? describe : describe.skip;

maybeDescribe('PgDatabase against a real Postgres (T-004 done-when)', () => {
  let db: PgDatabase;
  const testEmail = `db-adapter-test-${randomUUID()}@example.test`;

  beforeAll(async () => {
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)

  afterAll(async () => {
    await db.query('delete from users where email = $1', [testEmail]);
    await db.end();
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  it('rolls back every statement when the transaction function throws', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query(`insert into users (email, password_hash, role) values ($1, $2, $3)`, [
          testEmail,
          'x',
          'user',
        ]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await db.query<{ id: string }>('select id from users where email = $1', [testEmail]);
    expect(rows).toHaveLength(0);
  });

  it('commits every statement when the transaction function resolves', async () => {
    const result = await db.transaction(async (tx) => {
      await tx.query(`insert into users (email, password_hash, role) values ($1, $2, $3)`, [
        testEmail,
        'x',
        'user',
      ]);
      return 'ok';
    });
    expect(result).toBe('ok');

    const rows = await db.query<{ id: string }>('select id from users where email = $1', [testEmail]);
    expect(rows).toHaveLength(1);
  });

  it('cascades backtest_sessions delete -> orders -> order_modifications', async () => {
    const [user] = await db.query<{ id: string }>('select id from users where email = $1', [testEmail]);
    const sessionId = randomUUID();
    const orderId = randomUUID();

    await db.query(
      `insert into backtest_sessions
         (id, user_id, name, status, session_currency, timeframe, period_from_ms, period_to_ms,
          cursor_ms, initial_balance, balance, default_risk_pct, costs_enabled, commission_pct,
          spread, layout)
       values ($1,$2,'cascade-test','active','USD','1m',0,1000,0,1000,1000,1,false,0,0,'{}')`,
      [sessionId, user.id],
    );
    await db.query(
      `insert into orders
         (id, session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, qty,
          risk_pct, risk_amount_ccy, sl_initial, sl_current)
       values ($1,$2,1,'p1','binance:BTCUSDT','long','market','pending',0,1,1,10,90,90)`,
      [orderId, sessionId],
    );
    await db.query(
      `insert into order_modifications (order_id, cursor_ms, field, old_value, new_value)
       values ($1,0,'sl',90,80)`,
      [orderId],
    );

    await db.query('delete from backtest_sessions where id = $1', [sessionId]);

    const orders = await db.query('select id from orders where session_id = $1', [sessionId]);
    const mods = await db.query('select id from order_modifications where order_id = $1', [orderId]);
    expect(orders).toHaveLength(0);
    expect(mods).toHaveLength(0);
  });

  it('parses numeric and bigint columns to JS number at the boundary', async () => {
    const [row] = await db.query<{ n: number; b: number }>(
      `select 12345.6789::numeric(20,8) as n, 1700000000000::bigint as b`,
    );
    expect(row.n).toBe(12345.6789);
    expect(typeof row.n).toBe('number');
    expect(row.b).toBe(1700000000000);
    expect(typeof row.b).toBe('number');
  });
});
