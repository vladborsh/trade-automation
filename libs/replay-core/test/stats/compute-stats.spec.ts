import { SessionAggregatesSchema, SessionStatsSchema } from '@trade-automation/contracts';
import { StatsOrder, computeStats, toSessionAggregates } from '../../src/stats';
import {
  AGGREGATES_FIXTURES,
  STATS_FIXTURES,
  STATS_INITIAL_BALANCE as BAL,
  STATS_PERIOD_FROM_MS as FROM,
} from '../../src/fixtures';

/** Deep equality with a float tolerance on every number. */
function expectClose(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Math.abs(actual - expected) > 1e-9) throw new Error(`${path}: expected ${expected}, got ${actual}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    expect({ path, value: actual }).toEqual({ path, value: expected });
    return;
  }
  expect({ path, keys: Object.keys(actual as object).sort() }).toEqual({ path, keys: Object.keys(expected).sort() });
  for (const k of Object.keys(expected)) {
    expectClose((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
  }
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('computeStats — §8 (architecture/backtest-app-system-design.md §8)', () => {
  it.each(STATS_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expectClose(computeStats(f.orders, BAL, FROM), f.expected);
  });

  it.each(STATS_FIXTURES.map((f) => [f.name, f] as const))(
    'is independent of input order, to the last bit: %s',
    (_name, f) => {
      const reference = computeStats(f.orders, BAL, FROM);
      for (const shuffled of permutations(f.orders)) expect(computeStats(shuffled, BAL, FROM)).toEqual(reference);
    },
  );

  it('every fixture result is a valid contract SessionStats', () => {
    for (const f of STATS_FIXTURES) expect(SessionStatsSchema.safeParse(computeStats(f.orders, BAL, FROM)).success).toBe(true);
  });

  it('ignores orders that are not closed', () => {
    const f = STATS_FIXTURES[2];
    const noise: StatsOrder[] = (['pending', 'open', 'cancelled'] as const).map((status, i) => ({
      ...f.orders[0],
      id: `00000000-0000-4000-8000-00000000009${i}`,
      seq: 90 + i,
      status,
      exitTimeMs: null,
      pnlCcy: null,
      pnlR: null,
    }));
    expect(computeStats([...noise, ...f.orders], BAL, FROM)).toEqual(computeStats(f.orders, BAL, FROM));
  });

  it('refuses a closed order without its result', () => {
    const o = STATS_FIXTURES[1].orders[0];
    expect(() => computeStats([{ ...o, pnlCcy: null }], BAL, FROM)).toThrow(/pnlCcy/);
    expect(() => computeStats([{ ...o, exitTimeMs: null }], BAL, FROM)).toThrow(/exitTimeMs/);
  });
});

describe('toSessionAggregates — the backtest_sessions columns (§3, decision 38)', () => {
  it.each(AGGREGATES_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const stats = computeStats(STATS_FIXTURES[f.statsFixture].orders, BAL, FROM);
    expectClose(toSessionAggregates(stats, f.statsComputedAt), f.expected);
  });

  it('is a pure projection: every column is the SessionStats field itself, bit for bit', () => {
    for (const f of STATS_FIXTURES) {
      const s = computeStats(f.orders, BAL, FROM);
      const a = toSessionAggregates(s, 1);
      expect(SessionAggregatesSchema.safeParse(a).success).toBe(true);
      expect(a).toEqual({
        tradesCount: s.trades, winsCount: s.wins, lossesCount: s.losses,
        pnlCcy: s.pnl, pnlR: s.pnlR, profitFactor: s.profitFactor,
        maxDrawdownCcy: s.maxDrawdownCcy, maxDrawdownR: s.maxDrawdownR,
        avgWinCcy: s.avgWin, avgWinR: s.avgWinR, avgLossCcy: s.avgLoss, avgLossR: s.avgLossR,
        statsComputedAt: 1,
      });
    }
  });
});
