import { Candle } from '@trade-automation/contracts';
import { IndicatorSeries } from './series';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * T-034 — the series form of the lifted `computeVwapBand` (vwap.ts, unchanged). The lifted function
 * has no day reset: the plug-in hands it its bias window B = `[utcMidnight(now) + 1 min, now]`
 * (vwap-band-reversal.windows.ts). So the value at bar i is `computeVwapBand(B_i)`, where B_i holds
 * the bars of `bars[0..i]` with openTime in `[utcMidnight(t_i) + 1 min, t_i]`:
 * - **anchored to the UTC day**, restarting at the first bar at or after 00:01 UTC. The 00:00 bar
 *   itself, bug-faithfully, belongs to no window and has no point, so on a 1d timeframe nothing is
 *   drawn;
 * - `vwap` is the cumulative close·volume / volume of B_i; the band is `vwap ± σ`, where σ is the
 *   population standard deviation of every deviation `close_j − vwap_j` in B_i, each measured
 *   against the VWAP *as of bar j*.
 *
 * O(n): running sums for the VWAP (the same additions in the same order as the lifted loop, so
 * `vwap` is bit-identical), and Welford's update for σ (1e-9 relative to the lifted two-pass
 * formula). Zero cumulative volume gives no point, as the lifted guard does. A zero-volume bar
 * *before* any volume that day makes the lifted σ NaN for the rest of the day; those band points
 * are left out rather than drawn as NaN. Output series: `vwap`, `upper`, `lower`.
 */
export function vwapBandSeries(bars: readonly Candle[]): IndicatorSeries<'vwap' | 'upper' | 'lower'> {
  const vwap: IndicatorSeries['vwap'] = [];
  const upper: IndicatorSeries['upper'] = [];
  const lower: IndicatorSeries['lower'] = [];

  let dayStart = Number.NaN;
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (const bar of bars) {
    const midnight = bar.openTime - (bar.openTime % DAY_MS);
    if (bar.openTime < midnight + MINUTE_MS) continue; // the 00:00 bar: before B opens
    if (midnight !== dayStart) {
      dayStart = midnight;
      cumulativeVolume = 0;
      cumulativeValue = 0;
      count = 0;
      mean = 0;
      m2 = 0;
    }
    cumulativeVolume += bar.volume;
    cumulativeValue += bar.close * bar.volume;
    const v = cumulativeValue / cumulativeVolume;
    const deviation = bar.close - v;
    count++;
    const delta = deviation - mean;
    mean += delta / count;
    m2 += delta * (deviation - mean);

    if (cumulativeVolume === 0 || !Number.isFinite(v)) continue;
    vwap.push({ time: bar.openTime, value: v });
    const stdev = Math.sqrt(Math.max(0, m2 / count));
    if (!Number.isFinite(stdev)) continue;
    upper.push({ time: bar.openTime, value: v + stdev });
    lower.push({ time: bar.openTime, value: v - stdev });
  }
  return { vwap, upper, lower };
}
