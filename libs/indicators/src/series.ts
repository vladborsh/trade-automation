import { Candle } from '@trade-automation/contracts';

/** One defined indicator value, at the `openTime` of the bar it belongs to. */
export interface IndicatorValue {
  time: number;
  value: number;
}

/**
 * architecture/backtest-app-system-design.md §2.1 — an indicator's output: one series per output
 * name (`macd`/`signal`/`hist`, `upper`/`middle`/`lower`, `k`/`d`, or the indicator's own id for
 * single-output ones), each aligned to bar `openTime`. A series holds **only defined values**: it
 * starts at the first bar where the output is defined (no zeros, no NaN during the warm-up) and
 * then has one point per bar. Defined here rather than in contracts: indicators are computed on
 * the client only (decision 11) and never cross the wire.
 */
export type IndicatorSeries<K extends string = string> = Record<K, IndicatorValue[]>;

/** Positive integer parameter check; throws RangeError otherwise. */
export function assertLength(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer (got ${value})`);
}

/** The points of `values` from index `start` on, stamped with the bars' openTime. */
export function toSeries(bars: readonly Candle[], values: ArrayLike<number>, start: number): IndicatorValue[] {
  const out: IndicatorValue[] = [];
  for (let i = start; i < bars.length; i++) out.push({ time: bars[i].openTime, value: values[i] });
  return out;
}

/**
 * Simple moving average of `xs` over `n`, starting at index `from` (the first input used). Returns
 * the full-length array (entries before `start` are 0 and meaningless) and `start = from + n − 1`,
 * the first defined index; `start >= xs.length` means never defined. A running sum keeps it O(n).
 */
export function smaOf(xs: ArrayLike<number>, n: number, from = 0): { values: Float64Array; start: number } {
  const values = new Float64Array(xs.length);
  const start = from + n - 1;
  let sum = 0;
  for (let i = from; i < xs.length; i++) {
    sum += xs[i];
    if (i >= from + n) sum -= xs[i - n];
    if (i >= start) values[i] = sum / n;
  }
  return { values, start };
}

/**
 * Exponential moving average of `xs` over `n`, starting at index `from`: seeded at `from + n − 1`
 * with the SMA of the first `n` inputs, then `ema = α·x + (1 − α)·ema_prev` with `α = 2/(n + 1)`
 * (TA-Lib's default and TradingView's `ta.ema`).
 */
export function emaOf(xs: ArrayLike<number>, n: number, from = 0): { values: Float64Array; start: number } {
  const values = new Float64Array(xs.length);
  const start = from + n - 1;
  if (start >= xs.length) return { values, start };
  let seed = 0;
  for (let i = from; i <= start; i++) seed += xs[i];
  values[start] = seed / n;
  const alpha = 2 / (n + 1);
  for (let i = start + 1; i < xs.length; i++) values[i] = alpha * xs[i] + (1 - alpha) * values[i - 1];
  return { values, start };
}

export function closes(bars: readonly Candle[]): Float64Array {
  const out = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) out[i] = bars[i].close;
  return out;
}
