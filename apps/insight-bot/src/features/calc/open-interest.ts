import { WINDOWS, type FeatureFrameValues } from '../feature-keys';

/**
 * IB-015 — the open-interest group (§8.2): the level now, its 4 h and 24 h change, and whether
 * it sits at a 7-day high.
 *
 * Two rules, both about not inventing a comparison:
 *
 * - **A delta needs a reading at the far end of the window.** OI is sampled every 5 minutes,
 *   and the archive's history starts at a measured floor per symbol (2020-09 for BTC, 2021-12
 *   otherwise), so a symbol can easily have "now" and no reading 24 h ago. That yields `null`,
 *   not 0 % — a flat reading and an absent one are different claims, and `oi.d24h_pct = 0`
 *   would read as "unchanged".
 * - **The nearest reading is used, but only inside a tolerance.** Slots go missing; the value
 *   15 minutes either side of the mark is still a fair comparison, one three hours away is not.
 */

export interface OiPoint {
  /** Epoch ms. */
  ts: number;
  /** Base-unit open interest. */
  value: number;
}

export interface OiInput {
  /** Readings up to and including the frame's close, oldest first. */
  points: readonly OiPoint[];
  closeTime: number;
}

/** How far from the target a reading may sit and still anchor a delta: three 5-minute slots. */
export const NEAREST_TOLERANCE_MS = 15 * 60_000;

/** The reading nearest `target`, or null when the closest is outside the tolerance. */
export function nearestAt(points: readonly OiPoint[], target: number, toleranceMs = NEAREST_TOLERANCE_MS): OiPoint | null {
  let best: OiPoint | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const gap = Math.abs(p.ts - target);
    if (gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best !== null && bestGap <= toleranceMs ? best : null;
}

/** Percentage change from `then` to `now`, null when either side is missing or `then` is zero. */
export function pctChange(now: number | null, then: number | null): number | null {
  if (now === null || then === null || then === 0) return null;
  return ((now - then) / then) * 100;
}

export function computeOpenInterest(input: OiInput): FeatureFrameValues {
  const now = nearestAt(input.points, input.closeTime);
  const nowValue = now?.value ?? null;

  const ago4h = nearestAt(input.points, input.closeTime - WINDOWS.oiDelta4hMs);
  const ago24h = nearestAt(input.points, input.closeTime - WINDOWS.oiDelta24hMs);

  // the 7-day high is over readings actually inside the window; with fewer than a day of
  // history "at a 7-day high" is trivially true and therefore meaningless, so it is null
  const weekStart = input.closeTime - WINDOWS.oi7dHighMs;
  const inWeek = input.points.filter((p) => p.ts >= weekStart && p.ts <= input.closeTime);
  const spansADay = inWeek.length > 0 && input.closeTime - (inWeek[0] as OiPoint).ts >= 24 * 3_600_000;
  const at7dHigh = nowValue === null || !spansADay
    ? null
    : nowValue >= Math.max(...inWeek.map((p) => p.value));

  return {
    'oi.binance.now': nowValue,
    'oi.d4h_pct': pctChange(nowValue, ago4h?.value ?? null),
    'oi.d24h_pct': pctChange(nowValue, ago24h?.value ?? null),
    'oi.at_7d_high': at7dHigh,
  };
}
