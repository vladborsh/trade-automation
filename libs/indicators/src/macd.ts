import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries, assertLength, closes, emaOf, toSeries } from './series';

/**
 * MACD(fast, slow, signal) of the close (TradingView's `ta.macd`):
 * - `macd = EMA(fast) − EMA(slow)`, each EMA seeded independently from the first bar (see `ema`),
 *   so `macd` is first defined at bar `slow − 1`;
 * - `signal = EMA(signal)` of the `macd` series, seeded with the SMA of its first `signal` values —
 *   first defined at bar `slow + signal − 2`;
 * - `hist = macd − signal`, defined where `signal` is.
 *
 * Each output starts at its own first defined bar. (TA-Lib's `MACD` differs in two ways: it seeds
 * the fast EMA later, aligned to the slow one, and it reports all three outputs only from the
 * signal's start. After the warm-up both converge; the spec pins these values against TA-Lib's
 * own `EMA` rather than its `MACD`.) Requires `fast < slow`. Output series: `macd`, `signal`,
 * `hist`.
 */
export function macd(
  bars: readonly Candle[],
  params: { fast: number; slow: number; signal: number },
): IndicatorSeries<'macd' | 'signal' | 'hist'> {
  assertLength('fast', params.fast);
  assertLength('slow', params.slow);
  assertLength('signal', params.signal);
  if (params.fast >= params.slow) throw new RangeError(`fast (${params.fast}) must be below slow (${params.slow})`);

  const c = closes(bars);
  const fast = emaOf(c, params.fast);
  const slow = emaOf(c, params.slow);
  const line = new Float64Array(bars.length);
  for (let i = slow.start; i < bars.length; i++) line[i] = fast.values[i] - slow.values[i];
  const signal = emaOf(line, params.signal, slow.start);
  const hist = new Float64Array(bars.length);
  for (let i = signal.start; i < bars.length; i++) hist[i] = line[i] - signal.values[i];

  return {
    macd: toSeries(bars, line, slow.start),
    signal: toSeries(bars, signal.values, signal.start),
    hist: toSeries(bars, hist, signal.start),
  };
}
