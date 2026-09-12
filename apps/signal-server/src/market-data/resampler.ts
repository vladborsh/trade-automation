import { Candle, InstrumentId, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';

const DERIVED_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '4h', '1d'];

interface Bucket {
  bucketStart: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function bucketStartFor(openTime: number, tf: Timeframe): number {
  const ms = TIMEFRAME_MS[tf];
  return Math.floor(openTime / ms) * ms;
}

/**
 * architecture/live-signal-server.md §3.2, §4.1 — one definition of "an H1 bar" for the whole
 * system. Bar boundaries are UTC-aligned (00:00 UTC anchored), matching the research packages'
 * 1m -> 5m/1h resampling. Pure/deterministic: no I/O, so it is unit-testable directly against a
 * sequence of 1m candles (boundary correctness, a day boundary, a gap).
 */
export class Resampler {
  private readonly buckets = new Map<string, Bucket>();

  private key(instrument: InstrumentId, tf: Timeframe): string {
    return `${instrument}|${tf}`;
  }

  /**
   * Feed one closed 1m candle. Returns the closed coarser candles this bar completes
   * (a bar closes when a 1m candle from the *next* bucket arrives), plus the still-forming
   * bars for every derived timeframe (for chart display only — never fed to strategies).
   */
  onClosed1m(candle: Candle): { closed: Candle[]; forming: Candle[] } {
    if (candle.timeframe !== '1m' || !candle.closed) {
      throw new Error('Resampler.onClosed1m expects a closed 1m candle');
    }

    const closed: Candle[] = [];
    const forming: Candle[] = [];

    for (const tf of DERIVED_TIMEFRAMES) {
      const k = this.key(candle.instrument, tf);
      const bucketStart = bucketStartFor(candle.openTime, tf);
      const existing = this.buckets.get(k);

      if (existing && existing.bucketStart !== bucketStart) {
        closed.push(this.toCandle(candle.instrument, tf, existing, true));
        this.buckets.delete(k);
      }

      const current = this.buckets.get(k);
      const merged: Bucket = current
        ? {
            bucketStart: current.bucketStart,
            open: current.open,
            high: Math.max(current.high, candle.high),
            low: Math.min(current.low, candle.low),
            close: candle.close,
            volume: current.volume + candle.volume,
          }
        : {
            bucketStart,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          };
      this.buckets.set(k, merged);
      forming.push(this.toCandle(candle.instrument, tf, merged, false));
    }

    return { closed, forming };
  }

  private toCandle(instrument: InstrumentId, tf: Timeframe, b: Bucket, closedFlag: boolean): Candle {
    return {
      instrument,
      timeframe: tf,
      openTime: b.bucketStart,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      closed: closedFlag,
      source: 'resampled',
    };
  }
}
