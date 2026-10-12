import type { WebFrameTimeframe } from '@trade-automation/contracts';
import { TIMEFRAME_MS } from './recheck-schedule';

/**
 * IB-015 — how many frames a window should hold.
 *
 * Pure, and computed from the window rather than from the rows, which is the entire point: a
 * count derived from what is stored can never notice that something is not stored. "The pass was
 * not running" and "nothing was wrong" look identical in a count of frames — IB-BUG-010, one
 * layer up from the collectors.
 */
export function expectedFrames(tf: WebFrameTimeframe, fromMs: number, toMsExclusive: number): number {
  const span = TIMEFRAME_MS[tf];
  if (toMsExclusive <= fromMs) return 0;
  // Closes strictly inside the window: the first at or after `from`, the last before `to`.
  const first = Math.ceil(fromMs / span) * span;
  if (first >= toMsExclusive) return 0;
  return Math.floor((toMsExclusive - 1 - first) / span) + 1;
}
