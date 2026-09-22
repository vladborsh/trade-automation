import { TIMEFRAME_MS, type Candle, type Timeframe } from '@trade-automation/contracts';
import { bucketStart } from './fold-on-step';

/**
 * T-056 (design §5.4, the BUG-007 ruling as amended by the Tech Lead, option A): the open times (ms)
 * of every `tf` bucket from the panel's first loaded bar to the cursor's bucket that holds **no bar**
 * — interior gaps (weekends, session closes) and the stretch after a tape that ends early alike. The
 * chart gives each of them a point on a hidden helper series, so a replay panel's time axis has one
 * point per bucket: logical index ≡ time on every panel, and the synced window means the same thing
 * on each of them — before a market reopens, across it, and scrolled back into history.
 *
 * The cursor is exclusive (what is revealed is before it), so "the cursor's bucket" is the one holding
 * the last revealed minute: on a bucket boundary a panel that is up to date pads nothing after its
 * newest bar, the one that just closed. Empty when the panel has no bars.
 * A padded time is only a time: never a candle, never folded, never an indicator input or a fill path.
 */
export function padToBucket(bars: readonly Pick<Candle, 'openTime'>[], tf: Timeframe, cursorMs: number): number[] {
  if (bars.length === 0) return [];
  const step = TIMEFRAME_MS[tf];
  const end = bucketStart(cursorMs - 1, tf);
  const times: number[] = [];
  let i = 0;
  for (let t = bucketStart(bars[0].openTime, tf); t <= end; t += step) {
    while (i < bars.length && bucketStart(bars[i].openTime, tf) < t) i++;
    if (i < bars.length && bucketStart(bars[i].openTime, tf) === t) continue;
    times.push(t);
  }
  return times;
}
