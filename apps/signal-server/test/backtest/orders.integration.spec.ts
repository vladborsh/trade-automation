import { randomUUID } from 'crypto';
import { PlaceOrderRequest } from '@trade-automation/contracts';
import { computeStats, positionSize } from '@trade-automation/replay-core';
import { OrderService } from '../../src/backtest/order.service';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { BacktestRepositories, NewSession } from '../../src/backtest/session.repository.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { DAY, T0, candleStore, m1, fakeInstrumentConfig } from './fake-backtest';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';

/**
 * T-015 done-when against a real Postgres: opId idempotency under concurrency (D9), a manual
 * close that writes order + balance + aggregates in one transaction, rounding at the repository
 * boundary. Skipped (loudly) without DATABASE_URL. Use your own slot's database:
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('orders.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres order tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const BTC = 'binance:BTCUSDT' as const;
const C = T0 + 5 * DAY;
const BTC_CONTRACT = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 };

const NEW_SESSION: NewSession = {
  name: 'orders-it',
  sessionCurrency: 'USD',
  timeframe: '15m',
  periodFromMs: C,
  periodToMs: T0 + 10 * DAY,
  initialBalance: 10_000,
  defaultRiskPct: 1,
  costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
  skipWeekends: false,
  layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: BTC, signals: false }] },
};

const store = candleStore([
  m1(BTC, C - MIN, 100, 100.5, 97, 100),
  m1(BTC, C, 100, 100.4, 99.8, 100.2),
  m1(BTC, C + MIN, 100.2, 100.3, 98.5, 99),
  m1(BTC, C + 2 * MIN, 99, 102.2, 99, 102),
]);

maybeDescribe('orders against a real Postgres (T-015 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let service: OrderService;
  let alice: string;

  beforeAll(async () => {
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgBacktestRepositories(db);
    service = new OrderService(repos, store, fakeInstrumentConfig());
    alice = (
      await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
        `alice-${run}@orders-it.test`,
      ])
    )[0].id;
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)

  afterAll(async () => {
    await db.query(`delete from users where email like $1`, [`%-${run}@orders-it.test`]);
    await db.end();
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  const marketLong = (sessionId: string, over: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest => ({
    opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1, ...over,
  });
  const count = async (sql: string, params: unknown[]) => (await db.query(sql, params)).length;

  it('concurrent identical POSTs create exactly one order and all answer the same body', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const req = marketLong(s.id);

    const [first, ...rest] = await Promise.all([0, 1, 2, 3, 4].map(() => service.place(alice, s.id, req)));

    for (const r of rest) expect(r).toEqual(first);
    expect(await count(`select id from orders where session_id = $1`, [s.id])).toBe(1);
    expect(await count(`select op_id from backtest_ops where session_id = $1`, [s.id])).toBe(1);
  });

  it('concurrent different orders get distinct consecutive seq', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    await Promise.all([0, 1, 2, 3].map(() => service.place(alice, s.id, marketLong(s.id))));
    expect((await repos.orders.list(s.id)).map((o) => o.seq)).toEqual([1, 2, 3, 4]);
  });

  it('rounds to the column scale at the repository boundary', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    // D12: qty is on the 0.001 step (123.456); 1R = 123.456 × 0.9999997 has more than 8 decimals → numeric(20,8);
    // riskPct → numeric(8,4)
    const { order } = await service.place(alice, s.id, marketLong(s.id, { sl: 99.0000003, riskPct: 1.23456 }));
    const { qty, riskAmount } = positionSize(10_000, 1.23456, 100, 99.0000003, BTC_CONTRACT);
    expect(qty).toBe(123.456);
    expect(order.qty).toBe(123.456);
    expect(riskAmount.toFixed(12)).not.toBe(riskAmount.toFixed(8) + '0000');
    expect(order.riskAmountCcy).toBe(Number(riskAmount.toFixed(8)));
    expect(order.riskPct).toBe(1.2346);
    expect(await repos.orders.findById(s.id, order.id)).toEqual(order);
  });

  describe('D12 place refusals and the contract snapshot (T-053)', () => {
    const body = (e: unknown) => (e as { getStatus(): number; getResponse(): unknown }).getResponse();
    const refusal = (p: Promise<unknown>) =>
      p.then(
        () => 'placed',
        (e) => ({ status: (e as { getStatus(): number }).getStatus(), ...(body(e) as object) }),
      );

    it('a size under the venue minimum notional is 422 SIZE_BELOW_MINIMUM, naming the minimum and the risk % it needs', async () => {
      const s = await repos.sessions.insert(alice, NEW_SESSION);
      // 0.0001 % of 10 000 = 0.01 USD over a 1.0 stop → 0.01 BTC, notional 1 < 50
      await expect(refusal(service.place(alice, s.id, marketLong(s.id, { riskPct: 0.0001 })))).resolves.toEqual({
        status: 422,
        error: {
          code: 'SIZE_BELOW_MINIMUM',
          message: 'Below the venue minimum: the smallest order is 0.500 BTC (at least 50 notional), which needs a risk of at least 0.01 % at this stop.',
        },
      });
      expect(await count(`select id from orders where session_id = $1`, [s.id])).toBe(0);
    });

    it('a size that rounds below minQty is SIZE_BELOW_MINIMUM too', async () => {
      const s = await repos.sessions.insert(alice, NEW_SESSION);
      // 0.01 USD over a 50.0 stop → 0.0002 BTC → 0 on the 0.001 step
      await expect(refusal(service.place(alice, s.id, marketLong(s.id, { riskPct: 0.0001, sl: 50 })))).resolves.toEqual({
        status: 422,
        error: {
          code: 'SIZE_BELOW_MINIMUM',
          message: 'Below the venue minimum: the smallest order is 0.500 BTC (at least 50 notional), which needs a risk of at least 0.25 % at this stop.',
        },
      });
    });

    it('an order whose margin exceeds the account is 422 INSUFFICIENT_MARGIN', async () => {
      const s = await repos.sessions.insert(alice, NEW_SESSION);
      // 100 % over a 0.5 stop → 20 000 BTC, 2 000 000 notional / 125 = 16 000 margin > 10 000
      await expect(refusal(service.place(alice, s.id, marketLong(s.id, { riskPct: 100, sl: 99.5 })))).resolves.toEqual({
        status: 422,
        error: { code: 'INSUFFICIENT_MARGIN', message: 'Not enough margin: this order needs 16000.00 USD and 10000.00 USD is available.' },
      });
    });

    it('a placed order row carries contract_multiplier', async () => {
      const s = await repos.sessions.insert(alice, NEW_SESSION);
      const { order } = await service.place(alice, s.id, marketLong(s.id));
      expect(order.contractMultiplier).toBe(1);
      const [row] = await db.query<{ contract_multiplier: number }>(`select contract_multiplier from orders where id = $1`, [order.id]);
      expect(row.contract_multiplier).toBe(1);
    });

    it('pooled margin: a pending limit reserves margin against a second order, released when it is cancelled', async () => {
      const s = await repos.sessions.insert(alice, NEW_SESSION);
      // limit long at 99.8, stop 99: 60 % → 6 000 / 0.8 = 7 500 BTC; margin at the limit 7 500 × 99.8 / 125 = 5 988
      const { order: pending } = await service.place(alice, s.id, marketLong(s.id, { type: 'limit', limitPrice: 99.8, riskPct: 60 }));
      expect(pending).toMatchObject({ status: 'pending', qty: 7500 });
      // a market long at 100, stop 99: 60 % → 6 000 BTC, margin 4 800: fits alone (10 000), not next to the pending one (4 012)
      const second = marketLong(s.id, { riskPct: 60 });
      await expect(refusal(service.place(alice, s.id, second))).resolves.toEqual({
        status: 422,
        error: { code: 'INSUFFICIENT_MARGIN', message: 'Not enough margin: this order needs 4800.00 USD and 4012.00 USD is available.' },
      });
      await service.cancel(alice, s.id, pending.id, { opId: randomUUID(), cursorMs: C });
      await expect(service.place(alice, s.id, { ...second, opId: randomUUID() })).resolves.toMatchObject({ order: { qty: 6000, status: 'open' } });
    });
  });

  it('a manual close writes order, balance and aggregates together', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await service.place(alice, s.id, marketLong(s.id));
    await db.query(`update backtest_sessions set cursor_ms = $2 where id = $1`, [s.id, C + 3 * MIN]);

    const res = await service.close(alice, s.id, order.id, { opId: randomUUID(), cursorMs: C + 3 * MIN });

    const after = (await repos.sessions.findById(alice, s.id))!;
    expect(res.order).toMatchObject({ status: 'closed', exitPrice: 101.75, closeReason: 'manual', pnlCcy: 141.92, pnlR: 1.4192, maeR: 1.75 });
    expect(after.balance).toBe(10_141.92);
    expect(res.balance).toBe(10_141.92);
    const recomputed = computeStats(await repos.orders.listClosedForStats(s.id), s.initialBalance, s.periodFromMs);
    expect(after).toMatchObject({ tradesCount: 1, winsCount: 1, lossesCount: 0, pnlCcy: recomputed.pnl, pnlR: recomputed.pnlR, avgWinCcy: recomputed.avgWin });
    expect(after.statsComputedAt).not.toBeNull();
  });

  it('T-033: a modify writes the new level and its history rows together, rounded to the column scale', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await service.place(alice, s.id, marketLong(s.id, { tp: 110 }));
    await db.query(`update backtest_sessions set cursor_ms = $2 where id = $1`, [s.id, C + 3 * MIN]); // lastClose 102

    const moved = await service.modify(alice, s.id, order.id, { opId: randomUUID(), cursorMs: C + 3 * MIN, sl: 100.250000004, tp: 105 });

    expect(moved).toMatchObject({ slCurrent: 100.25, slInitial: 99, tpCurrent: 105, tpInitial: 110, riskAmountCcy: 100 });
    expect(await repos.orders.findById(s.id, order.id)).toEqual(moved);
    const rows = await repos.orders.listModifications(order.id);
    expect(rows.map(({ field, oldValue, newValue, cursorMs }) => ({ field, oldValue, newValue, cursorMs }))).toEqual([
      { field: 'sl', oldValue: 99, newValue: 100.25, cursorMs: C + 3 * MIN },
      { field: 'tp', oldValue: 110, newValue: 105, cursorMs: C + 3 * MIN },
    ]);
    expect((await service.get(alice, s.id, order.id)).modifications).toEqual(rows);
  });

  it('T-033: concurrent identical modifies write one set of rows and all answer the same order', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await service.place(alice, s.id, marketLong(s.id));
    const req = { opId: randomUUID(), cursorMs: C, sl: 98 };
    const [first, ...rest] = await Promise.all([0, 1, 2, 3].map(() => service.modify(alice, s.id, order.id, req)));
    for (const r of rest) expect(r).toEqual(first);
    expect(await repos.orders.listModifications(order.id)).toHaveLength(1);
  });

  it('T-033: a failure while writing the history rolls back the level and the op', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await service.place(alice, s.id, marketLong(s.id, { tp: 110 }));
    const failing: BacktestRepositories = {
      ...repos,
      transaction: (fn) =>
        repos.transaction((tx) =>
          fn({
            ...tx,
            // the real repository, with only the second history row failing (after the level was updated)
            orders: Object.assign(Object.create(tx.orders), {
              insertModification: (() => {
                let n = 0;
                return (m: Parameters<typeof tx.orders.insertModification>[0]) =>
                  n++ === 0 ? tx.orders.insertModification(m) : Promise.reject(new Error('boom'));
              })(),
            }),
          }),
        ),
    };
    const opId = randomUUID();
    await expect(new OrderService(failing, store, fakeInstrumentConfig()).modify(alice, s.id, order.id, { opId, cursorMs: C, sl: 98, tp: 105 })).rejects.toThrow('boom');

    expect(await repos.orders.findById(s.id, order.id)).toMatchObject({ slCurrent: 99, tpCurrent: 110 });
    expect(await repos.orders.listModifications(order.id)).toEqual([]);
    expect(await repos.ops.find(s.id, opId)).toBeNull();
  });

  it('a failure after the order row is closed rolls back the order, the balance and the op', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await service.place(alice, s.id, marketLong(s.id));
    const failing: BacktestRepositories = {
      sessions: repos.sessions,
      orders: repos.orders,
      ops: repos.ops,
      screenshots: repos.screenshots,
      transaction: (fn) =>
        repos.transaction((tx) =>
          fn({
            ...tx,
            // the real repository, with only applyTradeClose failing (after the order row was closed)
            sessions: Object.assign(Object.create(tx.sessions), {
              applyTradeClose: () => Promise.reject(new Error('boom')),
            }),
          }),
        ),
    };
    const opId = randomUUID();

    await expect(new OrderService(failing, store, fakeInstrumentConfig()).close(alice, s.id, order.id, { opId, cursorMs: C })).rejects.toThrow('boom');

    expect((await repos.orders.findById(s.id, order.id))!.status).toBe('open');
    expect((await repos.sessions.findById(alice, s.id))!).toMatchObject({ balance: 10_000, tradesCount: 0 });
    expect(await repos.ops.find(s.id, opId)).toBeNull();
    // and the same opId still works afterwards
    await expect(service.close(alice, s.id, order.id, { opId, cursorMs: C })).resolves.toMatchObject({ order: { status: 'closed' } });
  });
});
