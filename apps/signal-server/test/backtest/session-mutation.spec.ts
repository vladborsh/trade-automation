import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { runSessionMutation, VALUE_OUT_OF_RANGE_MESSAGE } from '../../src/backtest/session-mutation';
import { NewSession } from '../../src/backtest/session.repository.port';
import { DAY, FakeBacktestRepositories, T0 } from './fake-backtest';

/** T-059 — the pg 22003 mapping in `runSessionMutation`; the rollback itself is in advance-bounds.integration.spec. */
describe('runSessionMutation: numeric overflow (T-059)', () => {
  const newSession: NewSession = {
    name: 'mutation',
    sessionCurrency: 'USD',
    timeframe: '15m',
    periodFromMs: T0,
    periodToMs: T0 + DAY,
    initialBalance: 10_000,
    defaultRiskPct: 1,
    costs: { enabled: false, commissionPct: 0, spread: 0 },
    skipWeekends: false,
    layout: { id: 'l', name: 'L', grid: { columns: 1, rows: 1 }, panels: [{ id: 'btc', kind: 'candles', instrument: 'binance:BTCUSDT', signals: false }] },
  };
  const op = () => ({ opId: randomUUID(), kind: 'advance' as const, request: { toCursorMs: T0 + 60_000 } });

  async function setup() {
    const repos = new FakeBacktestRepositories();
    const session = await repos.sessions.insert('alice', newSession);
    return { repos, session };
  }

  it("pg 22003 ('numeric field overflow') is a 422 VALUE_OUT_OF_RANGE naming the 1e12 limit", async () => {
    const { repos, session } = await setup();
    const overflow = Object.assign(new Error('numeric field overflow'), { code: '22003' });
    const err = await runSessionMutation(repos, 'alice', session.id, op(), async () => {
      throw overflow;
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(422);
    expect((err as HttpException).getResponse()).toEqual({ error: { code: 'VALUE_OUT_OF_RANGE', message: VALUE_OUT_OF_RANGE_MESSAGE } });
    expect(VALUE_OUT_OF_RANGE_MESSAGE).toMatch(/below 1e12/);
  });

  it('any other failure passes through unchanged (a 5xx stays a 5xx)', async () => {
    const { repos, session } = await setup();
    const other = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    await expect(
      runSessionMutation(repos, 'alice', session.id, op(), async () => {
        throw other;
      }),
    ).rejects.toBe(other);
  });
});
