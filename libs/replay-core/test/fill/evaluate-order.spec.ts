import { CompactCandleTuple, FillEventSchema } from '@trade-automation/contracts';
import { EvaluableOrder, evaluateOrder, marketExitEvent, pathFromTuples, walkBarsPessimistic } from '../../src/fill';
import {
  FILL_TABLE_FIXTURES,
  FIXTURE_COSTS_ON,
  FIXTURE_LONG_ID,
  FillTableRow,
  MARKET_EXIT_FIXTURES,
  fixtureBar as bar,
} from '../../src/fixtures';

describe('evaluateOrder / walkBarsPessimistic — the §6 fill table (architecture/backtest-app-system-design.md §6)', () => {
  it.each(FILL_TABLE_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const walk = f.walk === '1m' ? evaluateOrder : walkBarsPessimistic;
    expect(walk(f.order, f.path, f.costs)).toEqual(f.expected);
  });

  it('covers every path-driven §6 row for long and short, costs on and off, on 1m and on session bars', () => {
    const rows: FillTableRow[] = [
      'Limit entry',
      'Stop exit',
      'Take-profit exit',
      'SL and TP both inside one 1m candle',
      'Limit fill and SL/TP in the same candle',
    ];
    for (const row of rows) {
      for (const side of ['long', 'short'] as const) {
        for (const enabled of [true, false]) {
          const hits = FILL_TABLE_FIXTURES.filter((f) => f.row === row && f.side === side && f.costs.enabled === enabled);
          expect({ row, side, enabled, covered: hits.some((f) => f.walk === '1m') }).toEqual({
            row, side, enabled, covered: true,
          });
        }
      }
    }
    for (const side of ['long', 'short'] as const) {
      expect(FILL_TABLE_FIXTURES.some((f) => f.side === side && f.walk === 'pessimistic-bar')).toBe(true);
    }
  });

  it('every expected event is a valid contract FillEvent', () => {
    for (const f of FILL_TABLE_FIXTURES) for (const e of f.expected) expect(FillEventSchema.safeParse(e).success).toBe(true);
  });
});

describe('evaluateOrder — order states', () => {
  const open: EvaluableOrder = {
    id: FIXTURE_LONG_ID, side: 'long', type: 'market', status: 'open',
    limitPrice: null, entryPrice: 1000, entryTimeMs: null, slCurrent: 990, tpCurrent: 1020,
  };
  const stopCandle = [bar(0, 1000, 1000, 980, 985)];

  it('returns nothing for closed and cancelled orders', () => {
    expect(evaluateOrder({ ...open, status: 'closed' }, stopCandle, FIXTURE_COSTS_ON)).toEqual([]);
    expect(evaluateOrder({ ...open, status: 'cancelled' }, stopCandle, FIXTURE_COSTS_ON)).toEqual([]);
  });

  it('returns nothing on an empty path', () => {
    expect(evaluateOrder(open, [], FIXTURE_COSTS_ON)).toEqual([]);
  });

  it('evaluates every candle of an open order with no entryTimeMs', () => {
    expect(evaluateOrder(open, stopCandle, FIXTURE_COSTS_ON)).toHaveLength(1);
  });

  it('stops at the first exit even when later candles would exit again', () => {
    const path = [bar(0, 1000, 1021, 999, 1015), bar(1, 1000, 1000, 980, 985)];
    expect(evaluateOrder(open, path, FIXTURE_COSTS_ON)).toEqual([
      expect.objectContaining({ reason: 'take-profit', time: path[0].openTime }),
    ]);
  });

  it('throws on a pending market order and on an open order without entryPrice', () => {
    expect(() => evaluateOrder({ ...open, status: 'pending' }, stopCandle, FIXTURE_COSTS_ON)).toThrow(/limit/);
    expect(() => evaluateOrder({ ...open, entryPrice: null }, stopCandle, FIXTURE_COSTS_ON)).toThrow(/entryPrice/);
  });
});

describe('marketExitEvent — §6 "Manual close / end of session"', () => {
  it.each(MARKET_EXIT_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(marketExitEvent(f.order, f.lastBar, f.reason, f.costs)).toEqual(f.expected);
  });

  it('carries the pessimistic resolution when asked', () => {
    const f = MARKET_EXIT_FIXTURES[0];
    expect(marketExitEvent(f.order, f.lastBar, f.reason, f.costs, 'pessimistic-bar').resolution).toBe('pessimistic-bar');
  });
});

describe('pathFromTuples', () => {
  it('maps compact [openTime, o, h, l, c, v] tuples to path bars, dropping volume', () => {
    const tuples: CompactCandleTuple[] = [[60_000, 1, 3, 0.5, 2, 99]];
    expect(pathFromTuples(tuples)).toEqual([{ openTime: 60_000, open: 1, high: 3, low: 0.5, close: 2 }]);
  });
});
