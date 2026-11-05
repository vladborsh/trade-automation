import { WEB_MARKET_PERIOD_SECONDS, type WebMarketPeriod } from '@trade-automation/contracts';

/**
 * IB-BUG-040: where a period's price change starts.
 *
 * Until this fix the reference was the close of the last whole hour ending at or before now − P. So
 * «за 1ч» covered 1–2 h, «за 4ч» 4–5 h and «за 24ч» 24–25 h. IB-119's chart showed it as an axis
 * starting at −118 min.
 *
 * **1h / 4h / 24h:** the close of the 5 m bar whose close is NEAREST now − P, so the change covers
 * P ± 2.5 min. The rarity sample is unchanged: `rollingChangesPct(hourly closes, P / 1 h)` already
 * holds changes over exactly P. Its points sit on whole hours, but each spans P. The old reference
 * compared a longer move against that sample, which overstated the price rarity.
 *
 * **7d:** stays on the baseline's hourly closes (`hourlyRef`). The window is 168–169 h, an error of
 * at most 1 h in 168 (0.6 %). The 7d change has no rarity to skew (positioning.service.ts).
 *
 * **Reads:** one exact-limit 5 m klines call per coin, cached `REF_BARS_CACHE_MS`. Every period's
 * reference for the whole cache life lies inside it (`refBarsWindow`). The limit is 289, which is
 * weight 2 by `klinesWeight`. At 30 coins: 60 weight per 30 min, about 2 weight/min, shared by
 * 1h, 4h and 24h.
 */
export const REF_BAR_MS = 5 * 60_000;
/**
 * How long one read of reference bars serves. It must stay under 57.5 min: a read just before a 5 m
 * close holds bars closed up to 5 min earlier, and the 1h reference rounds up to 2.5 min past now − 1 h.
 * Longer, and the 1h reference at the end of the cache life would not have closed at the read.
 */
export const REF_BARS_CACHE_MS = 30 * 60_000;
const H = 3_600_000;

/** Below 7d: the close time (ms) of the 5 m bar whose close is nearest now − P. */
export function refBarCloseMs(period: Exclude<WebMarketPeriod, '7d'>, nowMs: number): number {
  return Math.round((nowMs - WEB_MARKET_PERIOD_SECONDS[period] * 1000) / REF_BAR_MS) * REF_BAR_MS;
}

/**
 * One read of 5 m bars, made at `nowMs`, that holds `refBarCloseMs` for every period below 7d at any
 * moment in [nowMs, nowMs + REF_BARS_CACHE_MS]:
 * - it starts at the bar BEFORE the one closing at floor(now − 24 h);
 * - it ends at the last bar closed at `nowMs`.
 */
export function refBarsWindow(nowMs: number): { fromMs: number; limit: number } {
  const floor = (t: number) => Math.floor(t / REF_BAR_MS) * REF_BAR_MS;
  const fromMs = floor(nowMs - 24 * H) - REF_BAR_MS;
  const lastOpen = floor(nowMs) - REF_BAR_MS;
  return { fromMs, limit: (lastOpen - fromMs) / REF_BAR_MS + 1 };
}

/** The bar in `bars` (open time in s) that closes at `closeMs`, as `{close, closeMs}`; null when it is not held. */
export function refFromBars(bars: ReadonlyArray<{ time: number; close: number }>, closeMs: number): PriceRef | null {
  const bar = bars.find((b) => b.time * 1000 + REF_BAR_MS === closeMs);
  return bar ? { close: bar.close, closeMs } : null;
}

/**
 * 7d: the close of the last complete 1 h bar that ended at or before `atMs` (`closeTimes` are the bars'
 * OPEN times, ms). Null when none is held.
 */
export function hourlyRef(base: { closes: readonly number[]; closeTimes: readonly number[] }, atMs: number): PriceRef | null {
  for (let i = base.closeTimes.length - 1; i >= 0; i--) {
    const end = (base.closeTimes[i] as number) + H;
    if (end <= atMs) return { close: base.closes[i] as number, closeMs: end };
  }
  return null;
}

export interface PriceRef {
  close: number;
  /** When the reference bar closed (ms): the moment the change starts. */
  closeMs: number;
}
