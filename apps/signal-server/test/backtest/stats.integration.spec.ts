import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { Candle, InstrumentId } from '@trade-automation/contracts';
import { AdvanceService } from '../../src/backtest/advance.service';
import { OrderService } from '../../src/backtest/order.service';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { NewSession } from '../../src/backtest/session.repository.port';
import { SessionService } from '../../src/backtest/session.service';
import { StatsService } from '../../src/backtest/stats.service';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DAY, fakeInstrumentConfig, FakeScreenshotStore, T0 } from './fake-backtest';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';

/**
 * T-018 done-when against a real Postgres: no drift after real closes (a manual close and an
 * advance that stops a position — the T-015/T-017 paths), drift after `pnl_ccy` is corrupted on
 * the row directly in SQL. Skipped without DATABASE_URL:
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('stats.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres stats tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const BTC: InstrumentId = 'binance:BTCUSDT';
const C = T0 + 5 * DAY;

const NEW_SESSION: NewSession = {
  name: 'stats-it',
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

maybeDescribe('stats drift against a real Postgres (T-018 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  let root: string;
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let orders: OrderService;
  let advancer: AdvanceService;
  let stats: StatsService;
  let alice: string;
  let warn: jest.SpyInstance;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-it-'));
    const store = new FileCandleStore(root);
    const bars: Candle[] = [];
    for (let t = C - 10 * MIN; t < C + 30 * MIN; t += MIN) {
      const low = t === C + 5 * MIN ? 98.5 : 99.9;
      bars.push({ instrument: BTC, timeframe: '1m', openTime: t, open: 100, high: 100.1, low, close: 100, volume: 1, closed: true, source: 'venue-rest' });
    }
    await store.upsert(bars);
    await runMigrations({ connectionString: DATABASE_URL as string });
    db = new PgDatabase(DATABASE_URL as string);
    repos = new PgBacktestRepositories(db);
    orders = new OrderService(repos, store, fakeInstrumentConfig());
    advancer = new AdvanceService(repos, store);
    stats = new StatsService(repos, new SessionService(repos, fakeInstrumentConfig(), store as never, new FakeScreenshotStore()));
    alice = (
      await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
        `alice-${run}@stats-it.test`,
      ])
    )[0].id;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)

  afterAll(async () => {
    warn.mockRestore();
    await db.query(`delete from users where email like $1`, [`%-${run}@stats-it.test`]);
    await db.end();
    fs.rmSync(root, { recursive: true, force: true });
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  it('no drift after real closes; drift naming pnlCcy after pnl_ccy is corrupted in SQL', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const place = () =>
      orders.place(alice, s.id, { opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });
    const first = (await place()).order;
    await place();
    await orders.close(alice, s.id, first.id, { opId: randomUUID(), cursorMs: C }); // T-015 manual close
    await advancer.advance(alice, s.id, { opId: randomUUID(), toCursorMs: C + 15 * MIN }); // T-017 stop

    const clean = await stats.get(alice, s.id);
    expect(clean).toMatchObject({ drift: false, computed: { trades: 2 }, stored: { tradesCount: 2 } });
    expect(warn).not.toHaveBeenCalled();

    await db.query(`update backtest_sessions set pnl_ccy = pnl_ccy + 0.00001 where id = $1`, [s.id]);
    const drifted = await stats.get(alice, s.id);

    expect(drifted.drift).toBe(true);
    expect(drifted.stored.pnlCcy).toBeCloseTo(clean.stored.pnlCcy + 0.00001, 8);
    expect(warn).toHaveBeenCalledWith(`stats drift on session ${s.id}: pnlCcy`);
  });
});
