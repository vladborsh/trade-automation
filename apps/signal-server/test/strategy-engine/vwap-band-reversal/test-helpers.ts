import { Candle } from '@trade-automation/contracts';

/** Minimal Candle builder for vwap-band-reversal unit tests — instrument/timeframe/source are irrelevant to the pure indicator math. */
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
