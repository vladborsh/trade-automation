import { Candle } from '@trade-automation/contracts';

export interface VwapBandResult {
  nBias: number;
  vwap?: number;
  vwapTop?: number;
  vwapBottom?: number;
}

/**
 * knowledge/vwap-band-reversal-ict.md §1 (cmc-bot-main/src/indicator/tools/vwap.indicator.ts,
 * "last value only" form) — cumulative-volume VWAP over `bars` (the caller's bias window B,
 * already scoped to one UTC day, so there is no day-reset to apply here). `deviation_i =
 * close_i - vwap_i` using vwap *as of bar i*, not the final value; `stdev` is the *population*
 * standard deviation of every deviation in `bars` — for 1-minute bars starting at 00:01 the
 * bot's "expanding window sized to minutes-since-open" is always the whole array, so this
 * simplifies to "all deviations in B" (architecture/vwap-band-reversal-plugin.md §2.3).
 *
 * Zero cumulative volume (Researcher COVERAGE.md: never observed on the Capital.com tape, a
 * guard not an expected path) returns no band, matching the bot's NaN-comparisons-are-false
 * behaviour without propagating a non-finite number into the wire contract.
 */
export function computeVwapBand(bars: readonly Candle[]): VwapBandResult {
  const nBias = bars.length;
  if (nBias === 0) return { nBias };

  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  const deviations: number[] = [];
  let vwap = 0;

  for (const bar of bars) {
    cumulativeVolume += bar.volume;
    cumulativeValue += bar.close * bar.volume;
    vwap = cumulativeValue / cumulativeVolume;
    deviations.push(bar.close - vwap);
  }

  if (cumulativeVolume === 0 || !Number.isFinite(vwap)) {
    return { nBias };
  }

  const mean = deviations.reduce((acc, v) => acc + v, 0) / deviations.length;
  const variance = deviations.reduce((acc, v) => acc + (v - mean) ** 2, 0) / deviations.length;
  const stdev = Math.sqrt(variance);

  return { nBias, vwap, vwapTop: vwap + stdev, vwapBottom: vwap - stdev };
}
