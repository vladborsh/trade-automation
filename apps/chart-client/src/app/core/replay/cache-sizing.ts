import { TIMEFRAME_MS, type Timeframe } from '@trade-automation/contracts';

/** backtest-app-system-design.md §5.3 — one `GET …/candles/ahead` request. */
export const AHEAD_PAGE_SIZE = 5_000;

export interface CacheSizing {
  /** 1m candles to keep ahead of the cursor. */
  target1m: number;
  /** Refill when fewer than this many 1m candles remain ahead of the cursor. */
  refill1m: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * §5.3: "500 bars ahead, refill at 100", in bars of the current timeframe, converted to 1m and
 * capped so a 4h/1d session stays at ~2.4 MB per panel:
 * `target1m = clamp(500·tfMinutes, 500, 50 000)`, `refill1m = clamp(100·tfMinutes, 100, 10 000)`.
 */
export function cacheSizing(tf: Timeframe): CacheSizing {
  const tfMinutes = TIMEFRAME_MS[tf] / TIMEFRAME_MS['1m'];
  return {
    target1m: clamp(500 * tfMinutes, 500, 50_000),
    refill1m: clamp(100 * tfMinutes, 100, 10_000),
  };
}
