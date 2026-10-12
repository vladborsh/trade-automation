import {
  WEB_LIQUIDATION_MIN_HISTORY_DAYS, WEB_LIQUIDATION_NORM_DAYS,
  type WebLiquidationNormBasis, type WebLiquidationSideStats,
} from '@trade-automation/contracts';

/**
 * IB-038 — «× от нормы» (architecture/insight-bot-web-dashboard.md §12.2).
 *
 * Pure, and in its own file with its own spec, because this is the number most able to lie on
 * the page: a bare multiple reads as authority. §12.2 defines it as
 *
 *     ratio_W = Σ USD in the trailing W ÷ median of Σ USD over consecutive, non-overlapping,
 *               boundary-aligned W-windows in the trailing 30 days
 *
 * per side and in total, over the venues present in the window. Everything below exists to stop
 * that formula producing a confident number out of a sample that cannot support one.
 */

/** The median of a sample. `null` for an empty one — not 0, which is a measurement. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * When the norm period may start, in ms.
 *
 * §12.4 requires the median to be computed over the same venue set as its numerator, "so a venue
 * joining later does not fake a spike". Restricting the *rows* to that venue set is not enough:
 * if OKX started three days ago and the period is thirty, twenty-seven days of the sample contain
 * no OKX rows because OKX did not exist here, not because the market was calm. Those days drag
 * the median down and every later window looks like a surge.
 *
 * So the period also starts when the LAST member of the venue set started: the most recent of
 * the venues' first-seen times, floored at the 30-day cap.
 *
 * **An empty venue set returns `nowMs`, an empty period — not the cap.** Nothing has ever been
 * seen for this scope, and falling back to the cap would assert thirty days of observation from
 * zero rows, which is the same over-claim the basis field exists to prevent. A caught case: with
 * an empty table the response otherwise reported a 30-day norm period whose every window was
 * quiet, and called the result «нет нормы» — a measurement — rather than «нет данных».
 */
export function normPeriodStart(
  venueFirstSeenMs: readonly number[],
  nowMs: number,
  maxDays = WEB_LIQUIDATION_NORM_DAYS,
): number {
  if (venueFirstSeenMs.length === 0) return nowMs;
  return Math.max(nowMs - maxDays * 86_400_000, ...venueFirstSeenMs);
}

export interface NormInput {
  /** USD liquidated in the trailing window — the numerator. */
  trailing: number;
  /**
   * One sum per consecutive boundary-aligned window in the period, **including the empty ones**.
   * A quiet window is a real zero and belongs in the median; dropping it would compare a busy
   * window against the average of other busy windows, which is a different and much flatter
   * question.
   */
  alignedSums: readonly number[];
  /** Length of the norm period in days, from `normPeriodStart`. */
  periodDays: number;
}

/**
 * The ratio, or a stated reason there is none.
 *
 * Two refusals, both deliberate:
 *
 * - **under 7 days of history** (§12.2) — the median of a handful of windows is not a norm.
 * - **a median of 0** — most windows hold nothing, so there is no divisor. The temptation is to
 *   report ∞, or to fall back to a mean, or to show 0. All three put a number where there is no
 *   measurement. On the local tape this is the common case, not the edge case: 9 of 226 hours
 *   hold any liquidation at all, so the hourly median is 0 for nearly every coin.
 */
export function sideStats(input: NormInput): WebLiquidationSideStats {
  const { trailing, alignedSums, periodDays } = input;
  if (periodDays < WEB_LIQUIDATION_MIN_HISTORY_DAYS) {
    return { usd: trailing, median: null, ratio: null };
  }
  const m = median(alignedSums);
  if (m === null || m === 0) return { usd: trailing, median: m ?? 0, ratio: null };
  return { usd: trailing, median: m, ratio: trailing / m };
}

/** Why a window's ratios are absent, shared by its three sides. */
export function unavailableReason(
  periodDays: number,
  sides: readonly WebLiquidationSideStats[],
): WebLiquidationNormBasis['unavailable'] {
  if (periodDays < WEB_LIQUIDATION_MIN_HISTORY_DAYS) return 'insufficient_history';
  // 'no_norm' only when NO side could be measured: one side being quiet while the other is not
  // is an ordinary market, not a missing norm.
  return sides.every((s) => s.ratio === null) ? 'no_norm' : null;
}

/**
 * The basis that travels with every ratio.
 *
 * **`windowsObserved`, not elapsed days, is what the client reports**, on the Tech Lead's ruling
 * of 2026-10-07. The ws liquidation collectors record no uptime rows (IB-BUG-010), so a stretch
 * with no data is indistinguishable from a quiet market and elapsed time overstates what was
 * actually seen. "за 9 дней" claims nine days of observation we cannot prove; "9 of 226 windows"
 * claims only what is in the table.
 */
export function normBasis(args: {
  periodDays: number;
  alignedSums: readonly number[];
  venues: readonly string[];
  sides: readonly WebLiquidationSideStats[];
}): WebLiquidationNormBasis {
  return {
    periodDays: Math.round(args.periodDays * 10) / 10,
    windowsInPeriod: args.alignedSums.length,
    windowsObserved: args.alignedSums.filter((v) => v > 0).length,
    venues: [...args.venues].sort(),
    unavailable: unavailableReason(args.periodDays, args.sides),
  };
}
