import { randomUUID } from 'crypto';
import { computeStats } from '@trade-automation/replay-core';
import { SessionService } from '../../src/backtest/session.service';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { NewSession } from '../../src/backtest/session.repository.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DAY, T0, fakeInstrumentConfig, fakeStore } from './fake-backtest';

/**
 * T-013 done-when against a real Postgres: the session repository round-trips every column,
 * scopes every statement to its user (tenancy), and a session delete cascades to its children.
 * Skipped (loudly) without DATABASE_URL. Use your own slot's database:
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev3 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('sessions.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres session tests.');
}

const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const NEW_SESSION: NewSession = {
  name: 'integration',
  sessionCurrency: 'USD',
  timeframe: '15m',
  periodFromMs: T0 + 5 * DAY,
  periodToMs: T0 + 10 * DAY,
  initialBalance: 10_000.5,
  defaultRiskPct: 0.75,
  costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
  skipWeekends: false,
  notionalWarnMultiple: 5,
  layout: {
    id: 'crypto',
    name: 'Crypto',
    grid: { columns: 2, rows: 1 },
    panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }],
  },
};

maybeDescribe('backtest sessions against a real Postgres (T-013 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgBacktestRepositories(db);
    const insertUser = async (name: string) =>
      (
        await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
          `${name}-${run}@sessions-it.test`,
        ])
      )[0].id;
    alice = await insertUser('alice');
    bob = await insertUser('bob');
  });

  afterAll(async () => {
    await db.query(`delete from users where email like $1`, [`%-${run}@sessions-it.test`]); // sessions cascade
    await db.end();
  });

  it('inserts with cursor = periodFrom, balance = initialBalance, and round-trips every column', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    expect(s).toMatchObject({
      ...NEW_SESSION,
      status: 'active',
      cursorMs: NEW_SESSION.periodFromMs,
      balance: 10_000.5,
      completedAt: null,
      tradesCount: 0,
      pnlCcy: 0,
      profitFactor: null,
      statsComputedAt: null,
    });
    expect(typeof s.createdAt).toBe('number');
    expect(await repos.sessions.findById(alice, s.id)).toEqual(s);
  });

  it('scopes list / find / update / delete to the owner', async () => {
    const s = await repos.sessions.insert(alice, { ...NEW_SESSION, name: 'alice-only' });

    expect((await repos.sessions.listByUser(bob)).map((x) => x.id)).not.toContain(s.id);
    expect((await repos.sessions.listByUser(alice)).map((x) => x.id)).toContain(s.id);
    expect(await repos.sessions.findById(bob, s.id)).toBeNull();
    expect(await repos.sessions.update(bob, s.id, { name: 'hijack' })).toBeNull();
    expect(await repos.sessions.delete(bob, s.id)).toBe(false);

    const still = await repos.sessions.findById(alice, s.id);
    expect(still!.name).toBe('alice-only');
  });

  it('update changes only the given fields and bumps updated_at; list is newest first', async () => {
    const older = await repos.sessions.insert(alice, { ...NEW_SESSION, name: 'older' });
    const newer = await repos.sessions.insert(alice, { ...NEW_SESSION, name: 'newer' });
    const ids = (await repos.sessions.listByUser(alice)).map((x) => x.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));

    const tf = await repos.sessions.update(alice, older.id, { timeframe: '4h' });
    expect(tf).toMatchObject({ name: 'older', timeframe: '4h' });
    expect(tf!.updatedAt).toBeGreaterThanOrEqual(older.updatedAt);
    expect(await repos.sessions.update(alice, older.id, { name: 'renamed' })).toMatchObject({ name: 'renamed', timeframe: '4h' });
  });

  it('delete cascades to orders, order_modifications, screenshots and backtest_ops', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const orderId = randomUUID();
    await db.query(
      `insert into orders (id, session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, qty,
                           risk_pct, risk_amount_ccy, sl_initial, sl_current)
       values ($1, $2, 1, 'btc', 'binance:BTCUSDT', 'long', 'market', 'open', $3, 1, 1, 100, 90, 90)`,
      [orderId, s.id, NEW_SESSION.periodFromMs],
    );
    await db.query(`insert into order_modifications (order_id, cursor_ms, field, old_value, new_value) values ($1, $2, 'sl', 90, 95)`, [
      orderId,
      NEW_SESSION.periodFromMs,
    ]);
    await db.query(
      `insert into screenshots (session_id, order_id, kind, store_key, width_px, height_px, bytes, captured_at_ms)
       values ($1, $2, 'entry', 'k', 1, 1, 1, $3)`,
      [s.id, orderId, NEW_SESSION.periodFromMs],
    );
    await db.query(`insert into backtest_ops (session_id, op_id, response) values ($1, $2, '{}')`, [s.id, randomUUID()]);

    expect(await repos.sessions.delete(alice, s.id)).toBe(true);

    const count = async (sql: string, param: string) => (await db.query(sql, [param])).length;
    expect(await count(`select id from backtest_sessions where id = $1`, s.id)).toBe(0);
    expect(await count(`select id from orders where session_id = $1`, s.id)).toBe(0);
    expect(await count(`select id from order_modifications where order_id = $1`, orderId)).toBe(0);
    expect(await count(`select id from screenshots where session_id = $1`, s.id)).toBe(0);
    expect(await count(`select op_id from backtest_ops where session_id = $1`, s.id)).toBe(0);
  });

  it('GET /:id stats = computeStats over the session\'s closed orders read back from Postgres', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const service = new SessionService(repos, fakeInstrumentConfig(), fakeStore());
    const closedId = randomUUID();
    const exitTimeMs = NEW_SESSION.periodFromMs + 3 * 3_600_000;
    await db.query(
      `insert into orders (id, session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, qty,
                           risk_pct, risk_amount_ccy, sl_initial, sl_current, entry_price, entry_time_ms,
                           exit_price, exit_time_ms, close_reason, fill_resolution, pnl_ccy, pnl_r, mae_r)
       values ($1, $2, 1, 'btc', 'binance:BTCUSDT', 'short', 'market', 'closed', $3, 0.5, 1, 100.0025, 110, 110,
               100, $3, 90, $4, 'take-profit', 'pessimistic-bar', 150.25, 1.502462, -0.3125)`,
      [closedId, s.id, NEW_SESSION.periodFromMs, exitTimeMs],
    );
    // a still-open order must not count
    await db.query(
      `insert into orders (session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, qty,
                           risk_pct, risk_amount_ccy, sl_initial, sl_current)
       values ($1, 2, 'btc', 'binance:BTCUSDT', 'long', 'limit', 'pending', $2, 1, 1, 100, 90, 90)`,
      [s.id, NEW_SESSION.periodFromMs],
    );
    // bob cannot reach it
    await expect(service.detail(bob, s.id)).rejects.toMatchObject({ status: 404 });

    const detail = await service.detail(alice, s.id);

    const expected = computeStats(
      [
        {
          id: closedId,
          seq: 1,
          instrument: 'binance:BTCUSDT',
          side: 'short',
          status: 'closed',
          exitTimeMs,
          pnlCcy: 150.25,
          pnlR: 1.502462,
          maeR: -0.3125,
          fillResolution: 'pessimistic-bar',
          closeReason: 'take-profit',
        },
      ],
      NEW_SESSION.initialBalance,
      NEW_SESSION.periodFromMs,
    );
    expect(detail.stats).toEqual(expected);
    expect(detail.stats).toMatchObject({ trades: 1, wins: 1, pnl: 150.25, pnlR: 1.502462, pessimisticTrades: 1, maeWorst: -0.3125 });
    expect(detail.stats.equityCurve).toEqual([
      { time: NEW_SESSION.periodFromMs, balance: 10_000.5, balanceR: 0 },
      { time: exitTimeMs, balance: 10_150.75, balanceR: 1.502462 },
    ]);
    expect(detail.openOrders).toEqual([]);
    expect(detail.session.id).toBe(s.id);
  });

  it('findById with forUpdate works inside a transaction', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const name = await repos.transaction(async (tx) => {
      const locked = await tx.sessions.findById(alice, s.id, { forUpdate: true });
      return (await tx.sessions.update(alice, locked!.id, { name: 'in-tx' }))!.name;
    });
    expect(name).toBe('in-tx');
  });
});
