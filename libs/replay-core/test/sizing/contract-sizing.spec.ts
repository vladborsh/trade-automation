import type { ContractSpec, Costs, InstrumentId } from '@trade-automation/contracts';
import { computeMae, computeTradeResult, evaluateOrder } from '../../src/fill';
import { floatingPnl, openRisk } from '../../src/mark';
import {
  accountMargin,
  ceilToStep,
  floorToStep,
  insufficientMarginMessage,
  marginRequired,
  minimumOrderSize,
  notional,
  placementCheck,
  positionSize,
  riskPctForSize,
  sizeBelowMinimumMessage,
  stepDecimals,
  type MarginOrder,
} from '../../src/sizing';
import { computeStats } from '../../src/stats';

/**
 * T-035 — D12 (architecture/backtest-app-system-design.md §6 "Contract, sizing and margin"): sizing
 * rounded down to the venue step, the venue minimums, pooled margin, and the contract multiplier
 * through fill → PnL → MAE → mark → stats. Contract figures as in instruments.yaml.
 */
const BTC: ContractSpec = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 50, maxLeverage: 125 };
const EURUSD: ContractSpec = { unit: 'EUR', multiplier: 1, minQty: 100, qtyStep: 100, maxLeverage: 30, displayLot: 100_000 };
const DXY: ContractSpec = { unit: 'contracts', multiplier: 1, minQty: 1, qtyStep: 1, maxLeverage: 10 };
const X100: ContractSpec = { unit: 'contracts', multiplier: 100, minQty: 0.01, qtyStep: 0.01, maxLeverage: 20 };
const NO_COSTS: Costs = { enabled: false, commissionPct: 0, spread: 0 };
const COSTS: Costs = { enabled: true, commissionPct: 0.04, spread: 0.2 };

describe('steps (T-035)', () => {
  it('reads the decimals of a step as written', () => {
    expect([0.001, 0.01, 1, 100, 1e-8, 2.5e-7].map(stepDecimals)).toEqual([3, 2, 0, 0, 8, 8]);
    expect(() => stepDecimals(0)).toThrow(RangeError);
  });

  it('floorToStep rounds down, never up, to a clean decimal; ceilToStep rounds up', () => {
    expect(floorToStep(0.2139, 0.001)).toBe(0.213);
    expect(floorToStep(0.2129, 0.001)).toBe(0.212);
    expect(floorToStep(250.9, 100)).toBe(200);
    expect(floorToStep(99, 100)).toBe(0);
    expect(floorToStep(0.0009, 0.001)).toBe(0);
    expect(floorToStep(0.1 * 3, 0.1)).toBe(0.3); // 0.30000000000000004: float noise does not lose a step…
    expect(floorToStep(0.3, 0.1)).toBe(0.3); // …nor does 0.3 / 0.1 = 2.9999999999999996
    expect(ceilToStep(0.00125, 0.001)).toBe(0.002);
    expect(ceilToStep(0.002, 0.001)).toBe(0.002);
    for (let k = 1; k < 2000; k++) {
      const v = k * 0.0137;
      const q = floorToStep(v, 0.001);
      expect(q).toBeLessThanOrEqual(v * (1 + 1e-9)); // never above the value (beyond float noise)
      expect(v - q).toBeLessThan(0.001);
    }
  });
});

describe('positionSize (T-035)', () => {
  it('without a contract it is exactly the pre-D12 sizing', () => {
    expect(positionSize(10_000, 1, 100, 99)).toEqual({ qty: 100, riskAmount: 100, requestedRisk: 100 });
  });

  it('with a contract: qty rounded down to the step, 1R = what is actually at risk (never more than asked)', () => {
    const s = positionSize(10_000, 1, 40_000, 39_530, BTC); // raw 0.21276…
    expect(s.qty).toBe(0.212);
    expect(s.requestedRisk).toBe(100);
    expect(s.riskAmount).toBeCloseTo(0.212 * 470, 9); // 99.64
    expect(s.riskAmount).toBeLessThan(s.requestedRisk);
  });

  it('FX sizes in base units on a 100-unit step; float noise does not cost a step', () => {
    const s = positionSize(10_000, 1, 1.1, 1.095, EURUSD); // 100 / 0.00500000000000012 = 19 999.99…
    expect(s.qty).toBe(20_000);
    expect(s.riskAmount).toBeCloseTo(100, 9);
  });

  it('the multiplier divides the size: a 100× contract needs 100× fewer units for the same risk', () => {
    const s = positionSize(10_000, 1, 2000, 1990, X100); // 100 / (10 × 100)
    expect(s.qty).toBe(0.1);
    expect(s.riskAmount).toBeCloseTo(100, 9);
  });

  it('still throws for a zero stop distance or a non-positive balance / risk', () => {
    expect(() => positionSize(10_000, 1, 100, 100, BTC)).toThrow(RangeError);
    expect(() => positionSize(0, 1, 100, 99, BTC)).toThrow(RangeError);
    expect(() => positionSize(10_000, 0, 100, 99, BTC)).toThrow(RangeError);
  });
});

describe('venue minimums (T-035)', () => {
  it('a size that rounds below minQty is SIZE_BELOW_MINIMUM', () => {
    const s = positionSize(1_000, 0.01, 40_000, 39_530, BTC); // 0.1 / 470 = 0.00021 → 0
    expect(s.qty).toBe(0);
    expect(placementCheck({ qty: s.qty, notional: notional(s.qty, 40_000, BTC), contract: BTC, marginRequired: 0, available: 1_000 })).toBe('SIZE_BELOW_MINIMUM');
  });

  it('a size at minQty but below minNotional is SIZE_BELOW_MINIMUM; exactly at either minimum passes', () => {
    const s = positionSize(1_000, 0.05, 40_000, 39_530, BTC); // 0.5 / 470 = 0.00106 → 0.001, notional 40 < 50
    expect(s.qty).toBe(0.001);
    expect(placementCheck({ qty: 0.001, notional: notional(0.001, 40_000, BTC), contract: BTC, marginRequired: 0.32, available: 1_000 })).toBe('SIZE_BELOW_MINIMUM');
    expect(placementCheck({ qty: 0.001, notional: notional(0.001, 50_000, BTC), contract: BTC, marginRequired: 0.4, available: 1_000 })).toBeNull(); // notional exactly 50
    expect(placementCheck({ qty: 100, notional: 110, contract: EURUSD, marginRequired: 3.67, available: 1_000 })).toBeNull(); // qty exactly minQty
  });

  it('the refusal message names the minimum size and the risk % it would need (and that % really reaches it)', () => {
    expect(minimumOrderSize(BTC, 40_000)).toBe(0.002); // 50 / 40 000 = 0.00125 → up to the step
    expect(minimumOrderSize(EURUSD, 1.1)).toBe(100);
    expect(riskPctForSize(0.002, 470, BTC, 1_000)).toBe(0.1); // 0.094 % → rounded up to 0.10 %
    expect(sizeBelowMinimumMessage(BTC, 40_000, 470, 1_000)).toBe(
      'Below the venue minimum: the smallest order is 0.002 BTC (at least 50 notional), which needs a risk of at least 0.10 % at this stop.',
    );
    expect(sizeBelowMinimumMessage(DXY, 100, 0.5, 20)).toBe(
      'Below the venue minimum: the smallest order is 1 contracts, which needs a risk of at least 2.50 % at this stop.',
    );
    expect(positionSize(1_000, 0.1, 40_000, 39_530, BTC).qty).toBeGreaterThanOrEqual(0.002);
  });
});

describe('margin (T-035)', () => {
  const orders: MarginOrder[] = [
    { id: 'o1', instrument: 'binance:BTCUSDT', side: 'long', status: 'open', qty: 0.2, entryPrice: 40_000, limitPrice: null, maxLeverage: 125 },
    { id: 'p1', instrument: 'capitalcom:EURUSD', side: 'short', status: 'pending', qty: 20_000, entryPrice: null, limitPrice: 1.1, maxLeverage: 30 },
    { id: 'c1', instrument: 'capitalcom:DXY', side: 'long', status: 'closed', qty: 50, entryPrice: 100, limitPrice: null, maxLeverage: 10 },
  ];
  const lastClose = new Map<InstrumentId, number>([['binance:BTCUSDT', 39_000]]);

  it('initial margin is notional / maxLeverage', () => {
    expect(marginRequired(0.2, 40_000, BTC)).toBe(64);
    expect(marginRequired(10, 100, DXY)).toBe(100);
    expect(marginRequired(0.1, 2000, X100)).toBe(1000); // 0.1 × 100 × 2000 / 20
  });

  it('pools open (at entry) and pending (at limit) orders; equity carries the negative floating PnL; closed ignored', () => {
    const m = accountMargin(10_000, orders, lastClose, NO_COSTS);
    expect(m.equity).toBeCloseTo(9_800, 9); // (39 000 − 40 000) × 0.2 = −200
    expect(m.usedMargin).toBeCloseTo(64 + 733.3333333333, 6); // 0.2×40 000/125 + 20 000×1.1/30
    expect(m.available).toBeCloseTo(9_800 - 64 - 733.3333333333, 6);
    expect(m.available).toBeLessThan(10_000 - m.usedMargin); // the loss is counted
  });

  it('a pending limit reserves margin against a second order', () => {
    const withoutPending = accountMargin(10_000, orders.filter((o) => o.id !== 'p1'), lastClose, NO_COSTS);
    const withPending = accountMargin(10_000, orders, lastClose, NO_COSTS);
    expect(withoutPending.available - withPending.available).toBeCloseTo(733.3333333333, 6);
  });

  it('the placement check refuses the minimum first, then margin; margin exactly at the available passes', () => {
    const { available } = accountMargin(10_000, orders, lastClose, NO_COSTS);
    expect(placementCheck({ qty: 10, notional: 1_000, contract: DXY, marginRequired: 100, available })).toBeNull();
    expect(placementCheck({ qty: 3_000, notional: 300_000, contract: DXY, marginRequired: 30_000, available })).toBe('INSUFFICIENT_MARGIN');
    expect(placementCheck({ qty: 10, notional: 1_000, contract: DXY, marginRequired: available, available })).toBeNull();
    expect(placementCheck({ qty: 0, notional: 0, contract: DXY, marginRequired: 1e9, available })).toBe('SIZE_BELOW_MINIMUM');
    expect(insufficientMarginMessage(30_000, 9_002.666, 'USD')).toBe('Not enough margin: this order needs 30000.00 USD and 9002.67 USD is available.');
    expect(insufficientMarginMessage(10, -5, 'CHF')).toBe('Not enough margin: this order needs 10.00 CHF and 0.00 CHF is available.');
  });

  it('an open position whose instrument has no last close cannot be marked: it throws', () => {
    expect(() => accountMargin(10_000, orders, new Map(), NO_COSTS)).toThrow(/no last close for binance:BTCUSDT/);
  });
});

describe('a contract multiplier of 100, end to end: sizing → fill → PnL → MAE → mark → stats (T-035)', () => {
  const size = positionSize(10_000, 1, 2000, 1990, X100); // qty 0.1, 1R 100
  const base = {
    id: '00000000-0000-4000-8000-000000000100',
    side: 'long' as const,
    type: 'market' as const,
    status: 'open' as const,
    limitPrice: null,
    entryPrice: 2000.1, // market fill: last close 2000 + half spread 0.1
    entryTimeMs: 0,
    slCurrent: 1990,
    tpCurrent: 2020,
    riskAmountCcy: size.riskAmount,
  };
  const x100 = { ...base, qty: size.qty, contractMultiplier: 100 };
  const plain = { ...base, qty: 10 }; // the same position with multiplier 1
  const path = [
    { openTime: 60_000, open: 2005, high: 2012, low: 1995, close: 2010 },
    { openTime: 120_000, open: 2011, high: 2021, low: 2009, close: 2020 },
  ];

  it('the fill engine exits at the target (it never reads the size)', () => {
    expect(evaluateOrder(x100, path, COSTS)).toEqual([
      { orderId: base.id, kind: 'exit', time: 120_000, price: 2020, reason: 'take-profit', resolution: '1m' },
    ]);
  });

  it('commission, spread cost, PnL, R, MAE, the floating mark and open risk all scale by qty × multiplier', () => {
    const [exit] = evaluateOrder(x100, path, COSTS);
    const r = computeTradeResult(x100, exit, COSTS);
    expect(r.commissionCcy).toBeCloseTo(20_001 * 0.0004 + 20_200 * 0.0004, 9); // fee(2000.1 × 10) + fee(2020 × 10)
    expect(r.spreadCostCcy).toBeCloseTo(0.1 * 10, 9); // market entry paid half the spread on 10 units
    expect(r.pnlCcy).toBeCloseTo((2020 - 2000.1) * 10 - 16.0804, 9); // 182.9196
    expect(r.pnlR).toBeCloseTo(1.829196, 9);
    expect(r).toEqual(computeTradeResult(plain, exit, COSTS)); // identical to qty 10 at multiplier 1

    const closed = { ...x100, exitTimeMs: 120_000 };
    expect(computeMae(closed, path).maeR).toBeCloseTo((2000.1 - 1995) * 10 / 100, 9); // 0.51
    expect(floatingPnl(x100, 2010, COSTS)).toBeCloseTo((2009.9 - 2000.1) * 10 - 20_001 * 0.0004 - 20_099 * 0.0004, 9);
    expect(openRisk([x100])).toBeCloseTo((2000.1 - 1990) * 10, 9); // 101
  });

  it('stats over the closed trade see the scaled PnL and R', () => {
    const [exit] = evaluateOrder(x100, path, COSTS);
    const r = computeTradeResult(x100, exit, COSTS);
    const mae = computeMae({ ...x100, exitTimeMs: 120_000 }, path);
    const stats = computeStats(
      [{ id: base.id, seq: 1, instrument: 'capitalcom:US100', side: 'long', status: 'closed', exitTimeMs: 120_000, pnlCcy: r.pnlCcy, pnlR: r.pnlR, maeR: mae.maeR, fillResolution: '1m', closeReason: 'take-profit' }],
      10_000,
      0,
    );
    expect(stats.pnl).toBeCloseTo(182.9196, 9);
    expect(stats.pnlR).toBeCloseTo(1.829196, 9);
    expect(stats.maeWorst).toBeCloseTo(0.51, 9);
  });
});
