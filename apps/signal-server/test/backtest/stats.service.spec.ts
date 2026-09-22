import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { SessionAggregatesSchema, SessionStatsResponseSchema } from '@trade-automation/contracts';
import { computeStats } from '@trade-automation/replay-core';
import { AdvanceService } from '../../src/backtest/advance.service';
import { OrderService } from '../../src/backtest/order.service';
import { StatsService } from '../../src/backtest/stats.service';
import { DAY, FakeBacktestRepositories, T0, candleStore, createBody, m1, makeSessionService, fakeInstrumentConfig } from './fake-backtest';

const MIN = 60_000;
const C = T0 + 5 * DAY;
const BTC = 'binance:BTCUSDT' as const;

describe('StatsService (design §7.2, decision 38)', () => {
  let repos: FakeBacktestRepositories;
  let stats: StatsService;
  let sessionId: string;
  let warn: jest.SpyInstance;
  let store: ReturnType<typeof candleStore>;

  beforeEach(async () => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    repos = new FakeBacktestRepositories();
    // a flat tape with one stop-out low at C+5 (stops a long with sl 99)
    const tape = Array.from({ length: 40 }, (_, k) => {
      const t = C + (k - 10) * MIN;
      return m1(BTC, t, 100, 100.1, t === C + 5 * MIN ? 98.5 : 99.9, 100);
    });
    const eth = Array.from({ length: 40 }, (_, k) => m1('binance:ETHUSDT', C + (k - 10) * MIN, 100, 100.1, 99.9, 100));
    store = candleStore([...tape, ...eth]);
    const sessions = makeSessionService(repos, store);
    sessionId = (await sessions.create('alice', createBody())).id;
    stats = new StatsService(repos, sessions);

    // T-015 + T-017 flows: a manual close, then an advance that stops a second position
    const orders = new OrderService(repos, store, fakeInstrumentConfig());
    const place = () =>
      orders.place('alice', sessionId, { opId: randomUUID(), cursorMs: C, panelId: 'btc', side: 'long', type: 'market', sl: 99, riskPct: 1 });
    const first = (await place()).order;
    await place();
    await orders.close('alice', sessionId, first.id, { opId: randomUUID(), cursorMs: C });
    await new AdvanceService(repos, store).advance('alice', sessionId, { opId: randomUUID(), toCursorMs: C + 15 * MIN });
  });
  afterEach(() => warn.mockRestore());

  const row = () => repos.rows.get(sessionId)!.session;

  it('no drift after real closes; computed is the full recompute, stored is the row as it is', async () => {
    const res = await stats.get('alice', sessionId);

    expect(SessionStatsResponseSchema.parse(res)).toEqual(res);
    expect(res.drift).toBe(false);
    expect(res.computed).toEqual(computeStats(await repos.orders.listClosedForStats(sessionId), 10_000, C));
    expect(res.computed.trades).toBe(2);
    expect(res.stored).toEqual(SessionAggregatesSchema.parse(row()));
    expect(warn).not.toHaveBeenCalled();
  });

  it('drift after an aggregate column is tampered with; warns with the session id and the field only; the row is left alone', async () => {
    row().pnlCcy += 0.01;
    const tampered = row().pnlCcy;

    const res = await stats.get('alice', sessionId);

    expect(res.drift).toBe(true);
    expect(res.stored.pnlCcy).toBe(tampered);
    expect(warn).toHaveBeenCalledWith(`stats drift on session ${sessionId}: pnlCcy`);
    expect(row().pnlCcy).toBe(tampered);
  });

  it('a fresh session with no trades has no drift', async () => {
    const fresh = await makeSessionService(repos, store).create('alice', createBody());
    expect((await stats.get('alice', fresh.id)).drift).toBe(false);
  });

  it("another user's session is a 404", async () => {
    await expect(stats.get('bob', sessionId)).rejects.toMatchObject({ status: 404 });
  });
});
