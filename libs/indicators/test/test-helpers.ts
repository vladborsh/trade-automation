import { Candle } from '@trade-automation/contracts';

/** Minimal Candle builder for the indicator unit tests (a copy of apps/signal-server/test/strategy-engine/vwap-band-reversal/test-helpers.ts, which its remaining specs still use) — instrument/timeframe/source are irrelevant to the pure indicator math. */
export function bar(
  openTime: number,
  ohlc: { open: number; high: number; low: number; close: number },
  volume = 1,
): Candle {
  return {
    instrument: 'capitalcom:US100',
    timeframe: '1m',
    openTime,
    ...ohlc,
    volume,
    closed: true,
    source: 'venue-rest',
  };
}
