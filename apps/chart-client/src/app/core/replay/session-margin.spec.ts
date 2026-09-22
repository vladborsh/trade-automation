import type { ContractSpec, Order } from '@trade-automation/contracts';
import { lastClosesByInstrument, marginUtilisation, sessionMargin } from './session-margin';

const BTC: ContractSpec = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, maxLeverage: 100 };
const US100: ContractSpec = { unit: 'contracts', multiplier: 1, minQty: 0.1, qtyStep: 0.1, maxLeverage: 20 };
const contracts: Record<string, ContractSpec> = { 'binance:BTCUSDT': BTC, 'capitalcom:US100': US100 };
const NO_COSTS = { enabled: false, commissionPct: 0, spread: 0 };
const order = (over: Partial<Order>): Order =>
  ({ id: 'o', instrument: 'binance:BTCUSDT', side: 'long', status: 'open', qty: 0.1, entryPrice: 60_000, limitPrice: null, contractMultiplier: 1, ...over }) as Order;

describe('sessionMargin (T-054)', () => {
  it('open orders at entry, pending at their limit, each at its instrument’s cap; equity marks the open ones', () => {
    const m = sessionMargin(
      10_000,
      [
        order({ id: 'a' }), // 6 000 / 100 = 60; floating (61 000 − 60 000) × 0.1 = +100
        order({ id: 'b', instrument: 'capitalcom:US100', status: 'pending', qty: 2, entryPrice: null, limitPrice: 18_000 }), // 36 000 / 20 = 1 800
        order({ id: 'c', status: 'closed' }), // ignored
      ],
      (id) => contracts[id] ?? null,
      new Map([['binance:BTCUSDT', 61_000]]),
      NO_COSTS,
    )!;
    expect(m.usedMargin).toBeCloseTo(1_860, 9);
    expect(m.equity).toBeCloseTo(10_100, 9);
    expect(m.available).toBeCloseTo(8_240, 9);
    expect(marginUtilisation(m)).toBeCloseTo(1_860 / 10_100, 12);
  });

  it('null when an open position cannot be marked (no last close for its instrument)', () => {
    expect(sessionMargin(10_000, [order({})], (id) => contracts[id] ?? null, new Map(), NO_COSTS)).toBeNull();
    expect(marginUtilisation(null)).toBeNull();
  });

  it('nothing open: all free, utilisation 0', () => {
    const m = sessionMargin(10_000, [], () => null, new Map(), NO_COSTS)!;
    expect(m).toEqual({ equity: 10_000, usedMargin: 0, available: 10_000 });
    expect(marginUtilisation(m)).toBe(0);
  });

  it('lastClosesByInstrument: each panel’s instrument to its last close, panels without a bar left out', () => {
    const closes: Record<string, number | null> = { btc: 61_000, us: null };
    const map = lastClosesByInstrument(
      [{ id: 'btc', instrument: 'binance:BTCUSDT' }, { id: 'us', instrument: 'capitalcom:US100' }],
      (id) => closes[id],
    );
    expect([...map]).toEqual([['binance:BTCUSDT', 61_000]]);
  });
});
