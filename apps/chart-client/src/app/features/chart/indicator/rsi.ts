import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §12.4 — Wilder's RSI, pure.
 *
 * Seeded with the simple average of the first `period` close-to-close changes, then Wilder
 * smoothing (`avg = (avg * (period − 1) + x) / period`). Indices `0 … period − 1` are `null`
 * (not enough changes yet — nothing is drawn there, never a misleading 50 or 0). A window with
 * no losses is 100, no gains 0, neither (flat) 50.
 */
export function rsiWilder(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period < 1 || closes.length <= period) {
    return out;
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(change, 0);
    avgLoss += Math.max(-change, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Bars at the start of the loaded buffer the pane leaves empty (§12.4 prepend stability): the
 * seed error decays by `(1 − 1/period)` per bar, so after `10 × period` bars an RSI computed
 * over this buffer and one computed over `older ++ buffer` (after `loadOlder()`) agree to
 * < 0.01 — the drawn line does not jump when history is prepended.
 */
export function RSI_STABLE_BARS(period: number): number {
  return 10 * period;
}

/** `rsiWilder`, with the first `RSI_STABLE_BARS(period)` entries forced to `null` — what the pane draws. */
export function rsiDrawable(closes: readonly number[], period: number): (number | null)[] {
  const stable = RSI_STABLE_BARS(period);
  return rsiWilder(closes, period).map((v, i) => (i < stable ? null : v));
}

export interface RsiLinePoint {
  time: UTCTimestamp;
  value: number;
}

/** Drawable RSI as line-series data at the candles' own times (no extra time-scale slots); nulls are dropped. */
export function rsiLineData(candles: readonly Candle[], period: number): RsiLinePoint[] {
  const values = rsiDrawable(
    candles.map((c) => c.close),
    period,
  );
  const out: RsiLinePoint[] = [];
  values.forEach((value, i) => {
    if (value !== null) {
      out.push({ time: (candles[i].openTime / 1000) as UTCTimestamp, value });
    }
  });
  return out;
}
