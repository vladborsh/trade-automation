import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { Candle, InstrumentId } from '@trade-automation/contracts';
import { AdvanceService } from '../../src/backtest/advance.service';
import { OrderService } from '../../src/backtest/order.service';
import { VALUE_OUT_OF_RANGE_MESSAGE } from '../../src/backtest/session-mutation';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { NewSession } from '../../src/backtest/session.repository.port';
import { SessionService } from '../../src/backtest/session.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DAY, fakeInstrumentConfig, FakeScreenshotStore, T0 } from './fake-backtest';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';

/**
 * BUG-002/003 ruling, the close paths against a real Postgres (migration 002 applied):
 * - a trade over 1e6 R — beyond the old numeric(12,6) — now closes and stores;
 * - a close whose currency PnL overflows numeric(20,8) (the documented residual limit) fails
 *   with 422 VALUE_OUT_OF_RANGE (T-059; a 500 before), and the whole advance rolls back: order still open, cursor and balance unchanged, no op row,
 *   the session still readable.
 * Skipped without DATABASE_URL:  DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('advance-bounds.integration.spec.ts: DATABASE_URL not set — skipping the close-path bound tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const BTC: InstrumentId = 'binance:BTCUSDT';
const C = T0 + 5 * DAY;

const newSession = (initialBalance: number): NewSession => ({
  name: 'advance-bounds',
  sessionCurrency: 'USD',
  timeframe: '15m',
  periodFromMs: C,
  periodToMs: T0 + 10 * DAY,
  initialBalance,
  defaultRiskPct: 1,
  costs: { enabled: true, commissionPct: 0.04, spread: 0.5 },
  skipWeekends: false,
  layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: BTC, signals: false }] },
});

maybeDescribe('close paths with extreme values (BUG-002/003 ruling)', () => {
  const run = randomUUID().slice(0, 8);
  let root: string;
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let orders: OrderService;
  let advancer: AdvanceService;
  let sessions: SessionService;
  let alice: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'advance-bounds-'));
    const store = new FileCandleStore(root);
    // flat at 100 (low 100, so a stop 0.001 below is never touched) until C, then a straight rally
    // to 1500 by C+10: a far target is hit.
    const bars: Candle[] = [];
    for (let t = C - 10 * MIN; t < C + 30 * MIN; t += MIN) {
      const k = (t - C) / MIN;
      const px = k < 1 ? 100 : Math.min(1500, 100 + k * 140);
      bars.push({ instrument: BTC, timeframe: '1m', openTime: t, open: px, high: px, low: px, close: px, volume: 1, closed: true, source: 'venue-rest' });
    }
    await store.upsert(bars);
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgBacktestRepositories(db);
    orders = new OrderService(repos, store, fakeInstrumentConfig());
    advancer = new AdvanceService(repos, store);
    sessions = new SessionService(repos, fakeInstrumentConfig(), store as never, new FakeScreenshotStore());
    alice = (
      await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
        `alice-${run}@advance-bounds.test`,
      ])
    )[0].id;
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)

  afterAll(async () => {
    await db.query(`delete from users where email like $1`, [`%-${run}@advance-bounds.test`]);
    await db.end();
    fs.rmSync(root, { recursive: true, force: true });
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  it('a trade of about 1.4 million R (beyond the old numeric(12,6)) closes and stores', async () => {
    const s = await repos.sessions.insert(alice, newSession(10_000));
    // entry 100.25, stop 99.999 (exactly the 0.001 minimum below lastClose 100). R is move / stop distance, so a
    // tiny size gives the same extreme R: 0.001 % → 1R 0.1 → qty 100 (D12: 80 margin at 125×; 1 % would need 80 000)
    const { order } = await orders.place(alice, s.id, { opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99.999, tp: 1400, riskPct: 0.001 });

    const res = await advancer.advance(alice, s.id, { opId: randomUUID(), toCursorMs: C + 15 * MIN });

    const row = (await repos.orders.findById(s.id, order.id))!;
    // the C+10 candle opens at 1500, beyond the 1400 target: a gap-through exit at the open (§6)
    expect(row).toMatchObject({ status: 'closed', closeReason: 'take-profit', exitPrice: 1500 });
    expect(row.pnlR!).toBeGreaterThan(1_000_000); // (1500 − 100.25) × qty / 1R ≈ 1.4e6 R
    expect(res.stats.pnlR).toBeCloseTo(row.pnlR!, 6);
    const after = (await repos.sessions.findById(alice, s.id))!;
    expect(after).toMatchObject({ tradesCount: 1, winsCount: 1, pnlR: row.pnlR, avgWinR: row.pnlR });
  });

  it('a close whose PnL overflows numeric(20,8) is a 422 VALUE_OUT_OF_RANGE (T-059), rolls the whole advance back; the session stays readable', async () => {
    // D12: the size must pass the margin check, so the balance carries it. Balance 1e10, 0.12 % risk, stop 0.001 away
    // → 1R 1.2e7, qty 1.2e10 (fits numeric(20,8); margin 1.2e10 × 100 / 125 = 9.6e9 < 1e10). The next candle opens at
    // 240, through the 200 target → pnl ≈ 1.2e10 × 140 ≈ 1.7e12, which does not fit.
    const s = await repos.sessions.insert(alice, newSession(10_000_000_000));
    const { order } = await orders.place(alice, s.id, { opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99.999, tp: 200, riskPct: 0.12 });
    const opId = randomUUID();

    const err = await advancer.advance(alice, s.id, { opId, toCursorMs: C + 15 * MIN }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(422);
    expect((err as HttpException).getResponse()).toEqual({ error: { code: 'VALUE_OUT_OF_RANGE', message: VALUE_OUT_OF_RANGE_MESSAGE } });
    expect(VALUE_OUT_OF_RANGE_MESSAGE).toMatch(/below 1e12/);

    expect((await repos.orders.findById(s.id, order.id))!).toMatchObject({ status: 'open', exitPrice: null, pnlCcy: null });
    expect((await repos.sessions.findById(alice, s.id))!).toMatchObject({ cursorMs: C, balance: 10_000_000_000, tradesCount: 0, status: 'active' });
    expect(await repos.ops.find(s.id, opId)).toBeNull();
    const detail = await sessions.detail(alice, s.id);
    expect(detail.openOrders.map((o) => o.id)).toEqual([order.id]);
    expect(detail.stats.trades).toBe(0);
  });
});
