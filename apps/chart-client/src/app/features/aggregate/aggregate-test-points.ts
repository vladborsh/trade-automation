import type { AggregateMetricPoint, InstrumentId } from '@trade-automation/contracts';

/** Spec fixtures (architecture/aggregate-oi.md §1) — not used by production code. */
export const BN: InstrumentId = 'binance:BTCUSDT';
export const BY: InstrumentId = 'bybit:BTCUSDT';
export const HL: InstrumentId = 'hyperliquid:BTC';
export const ALL: InstrumentId[] = [BN, BY, HL];

/** One aggregate bar: each present leg 1 000 BTC at $100 000 unless overridden. */
export function aggPoint(
  time: number,
  coverage: InstrumentId[],
  opts: { coverageStart?: boolean; open?: number; close?: number; notional?: boolean } = {},
): AggregateMetricPoint {
  const withNotional = opts.notional ?? true;
  const close = opts.close ?? coverage.length * 1e8;
  const open = opts.open ?? close;
  const ohlc = { open, high: Math.max(open, close), low: Math.min(open, close), close };
  return {
    aggregate: 'btc-perp-oi',
    metric: 'openInterest',
    timeframe: '5m',
    time,
    unit: 'base',
    value: coverage.length * 1000,
    ohlc: { open: 0, high: 0, low: 0, close: coverage.length * 1000 },
    ...(withNotional ? { notional: close, notionalOhlc: ohlc } : {}),
    samples: 1,
    coverage: [...coverage].sort(),
    complete: coverage.length === ALL.length,
    coverageStart: opts.coverageStart ?? false,
    members: coverage.map((source) => ({ source, value: 1000, ...(withNotional ? { notional: 1e8 } : {}) })),
  };
}
