import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Candle, InstrumentId } from '@trade-automation/contracts';
import { AdvanceService } from '../../src/backtest/advance.service';
import { OrderService } from '../../src/backtest/order.service';
import { PgBacktestRepositories } from '../../src/backtest/pg/pg-backtest-repositories';
import { NewSession } from '../../src/backtest/session.repository.port';
import { runMigrations } from '../../src/db/migration-runner';
import { PgDatabase } from '../../src/db/pg/pg-database';
import { FileCandleStore } from '../../src/storage/file/file-candle-store';
import { DB_HOOK_TIMEOUT_MS } from '../db/scratch-db';
import { DAY, T0, fakeInstrumentConfig } from './fake-backtest';

/**
 * T-017 done-when against a real Postgres: a replayed advance moves nothing; an advance and a
 * place-order racing on one session serialise (neither sees a half state); an advance that closes
 * a trade writes the order, cursor, balance and aggregates together. Skipped without DATABASE_URL:
 *   DATABASE_URL=postgres://backtest@localhost:5432/backtest_dev2 npm test
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.warn('advance.integration.spec.ts: DATABASE_URL not set — skipping real-Postgres advance tests.');
}
const maybeDescribe = DATABASE_URL ? describe : describe.skip;

const MIN = 60_000;
const BTC: InstrumentId = 'binance:BTCUSDT';
const C = T0 + 5 * DAY;

const NEW_SESSION: NewSession = {
  name: 'advance-it',
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

maybeDescribe('advance against a real Postgres (T-017 done-when)', () => {
  const run = randomUUID().slice(0, 8);
  let root: string;
  let db: PgDatabase;
  let repos: PgBacktestRepositories;
  let orders: OrderService;
  let advancer: AdvanceService;
  let alice: string;
  /**
   * BUG-014: requests the race test has started and not yet seen settle. If that test times out,
   * jest runs afterAll while these transactions still hold their row locks, and the cascading user
   * delete deadlocked on them (dev-1's capture, load ≈ 30). afterAll waits for them first, and a
   * timed-out loop (jest does not stop it) starts nothing new once teardown has begun.
   */
  const inFlight = new Set<Promise<unknown>>();
  let tearingDown = false;
  const tracked = <T>(work: Promise<T>): Promise<T> => {
    inFlight.add(work);
    return work.finally(() => inFlight.delete(work));
  };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'advance-it-'));
    const store = new FileCandleStore(root);
    // flat 100 from C-10 to C+30, with a 98.5 low at C+5 (stops a long with sl 99)
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
    alice = (
      await db.query<{ id: string }>(`insert into users (email, password_hash, role) values ($1, 'x', 'user') returning id`, [
        `alice-${run}@advance-it.test`,
      ])
    )[0].id;
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: migrates the slot database (waits on other workers' migration lock)

  afterAll(async () => {
    tearingDown = true;
    await Promise.allSettled([...inFlight]); // never delete under a transaction still running (BUG-014)
    await db.query(`delete from users where email like $1`, [`%-${run}@advance-it.test`]);
    await db.end();
    fs.rmSync(root, { recursive: true, force: true });
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: cascade-deletes this spec's users and everything they own

  const placeLong = (sessionId: string) =>
    orders.place(alice, sessionId, { opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });

  it('an advance that stops a trade writes order, cursor, balance and aggregates in Postgres', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const { order } = await placeLong(s.id); // entry 100.25, qty 100

    const res = await advancer.advance(alice, s.id, { opId: randomUUID(), toCursorMs: C + 15 * MIN });

    // stop 98.75: (98.75 - 100.25) * 100 = -150 - (4.01 + 3.95) = -157.96
    const row = (await repos.orders.findById(s.id, order.id))!;
    expect(row).toMatchObject({ status: 'closed', closeReason: 'stop', exitPrice: 98.75, exitTimeMs: C + 5 * MIN, pnlCcy: -157.96, pnlR: -1.5796 });
    expect(res.orders).toEqual([row]);
    expect((await repos.sessions.findById(alice, s.id))!).toMatchObject({
      cursorMs: C + 15 * MIN, balance: 9842.04, tradesCount: 1, lossesCount: 1, pnlCcy: -157.96, pnlR: -1.5796,
    });
  });

  it('a replayed advance returns the stored body and moves nothing', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const opId = randomUUID();
    const first = await advancer.advance(alice, s.id, { opId, toCursorMs: C + 15 * MIN });
    const replay = await advancer.advance(alice, s.id, { opId, toCursorMs: C + 15 * MIN });

    expect(replay).toEqual(first);
    expect((await repos.sessions.findById(alice, s.id))!.cursorMs).toBe(C + 15 * MIN);
    expect((await db.query(`select op_id from backtest_ops where session_id = $1`, [s.id])).length).toBe(1);
  });

  it('BUG-004: an opId used by a place and then sent with an advance is 409; the cursor does not move', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const opId = randomUUID();
    await orders.place(alice, s.id, { opId, cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });

    await expect(advancer.advance(alice, s.id, { opId, toCursorMs: C + 60 * MIN })).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'OP_ID_REUSED', message: 'opId already used for a different request' } },
    });
    expect((await repos.sessions.findById(alice, s.id))!.cursorMs).toBe(C);
    const [row] = await db.query<{ kind: string; fingerprint: string }>(`select kind, fingerprint from backtest_ops where session_id = $1`, [s.id]);
    expect(row.kind).toBe('place');
    expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('BUG-004: a row from before migration 003 (NULL kind and fingerprint) still replays', async () => {
    const s = await repos.sessions.insert(alice, NEW_SESSION);
    const opId = randomUUID();
    const legacy = { cursorMs: C + 15 * MIN, status: 'active', balance: 10_000, events: [], orders: [], stats: { legacy: true } };
    await db.query(`insert into backtest_ops (session_id, op_id, response) values ($1, $2, $3)`, [s.id, opId, JSON.stringify(legacy)]);

    expect(await advancer.advance(alice, s.id, { opId, toCursorMs: C + 60 * MIN })).toEqual(legacy);
    expect((await repos.sessions.findById(alice, s.id))!.cursorMs).toBe(C);
  });

  it('an advance and a place-order racing on one session serialise — never a half state', async () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      if (tearingDown) return; // this test timed out and afterAll has begun: start nothing under it
      const s = await tracked(repos.sessions.insert(alice, NEW_SESSION));
      // alternate which request is issued first so both orderings occur
      const doPlace = () => tracked(placeLong(s.id));
      const doAdvance = () => tracked(advancer.advance(alice, s.id, { opId: randomUUID(), toCursorMs: C + 15 * MIN }));
      const [placed, advanced] =
        i % 2 === 0
          ? await Promise.allSettled([doPlace(), doAdvance()])
          : await Promise.allSettled([doAdvance(), doPlace()]).then(([a, p]) => [p, a] as const);
      expect(advanced.status).toBe('fulfilled');
      const rows = await repos.orders.list(s.id);
      expect((await repos.sessions.findById(alice, s.id))!.cursorMs).toBe(C + 15 * MIN);

      if (placed.status === 'fulfilled') {
        // the place committed first, so the advance saw the order and walked it into its stop
        outcomes.add('place-then-advance');
        expect(rows.map((o) => [o.status, o.closeReason])).toEqual([['closed', 'stop']]);
        expect((advanced as PromiseFulfilledResult<{ orders: unknown[] }>).value.orders).toHaveLength(1);
      } else {
        // the advance committed first, so the place saw the moved cursor and was refused
        outcomes.add('advance-then-place');
        expect((placed.reason as { getResponse(): { error: { code: string } } }).getResponse().error.code).toBe('CURSOR_MISMATCH');
        expect(rows).toEqual([]);
      }
    }
    // eslint-disable-next-line no-console
    console.log('advance/place race outcomes seen:', [...outcomes].join(', '));
  }, DB_HOOK_TIMEOUT_MS); // BUG-014: 10 × (insert a session, two racing transactions, 2 reads) — seconds each under load
});
