import type { WebLiquidationEpisodeNorm } from '@trade-automation/contracts';
import { EPISODE_FLOOR_USD, EPISODE_MIN_HELD_DAYS, EPISODE_TARGET_PER_WEEK } from '../../insights/thresholds';

/**
 * IB-133 (liquidation-episodes design E2) — the norm an episode must clear, set by RATE, not by
 * dollars:
 *
 *     held = min(30 d, the tape this database has; a venue joining later starts it, `normPeriodStart`)
 *     k    = max(1, round(EPISODE_TARGET_PER_WEEK × held_days / 7))
 *     T    = max(EPISODE_FLOOR_USD, the k-th largest candidate sum over `held`)
 *
 * So over the trailing window, about `EPISODE_TARGET_PER_WEEK` candidates a week clear T: a hot week
 * shows more (up to the cap), a calm one fewer, possibly none. With fewer than k candidates in the
 * window, every one of them would qualify, and T is the floor.
 *
 * Under `EPISODE_MIN_HELD_DAYS` of tape there is no norm at all: `collecting`, with whole hours held.
 */
export function episodeNorm(args: {
  /** Every candidate's sum over the trailing `held` window (any order). */
  candidateSums: readonly number[];
  heldMs: number;
  targetPerWeek?: number;
  floorUsd?: number;
}): WebLiquidationEpisodeNorm {
  const targetPerWeek = args.targetPerWeek ?? EPISODE_TARGET_PER_WEEK;
  const floorUsd = args.floorUsd ?? EPISODE_FLOOR_USD;
  const heldDays = Math.max(0, args.heldMs) / 86_400_000;
  if (heldDays < EPISODE_MIN_HELD_DAYS) {
    return { status: 'collecting', collectingHours: Math.floor(Math.max(0, args.heldMs) / 3_600_000) };
  }
  const k = Math.max(1, Math.round((targetPerWeek * heldDays) / 7));
  const desc = [...args.candidateSums].sort((a, b) => b - a);
  const kth = desc[k - 1] ?? 0;
  return {
    status: 'ready',
    thresholdUsd: Math.max(floorUsd, kth),
    heldDays: Math.round(heldDays * 10) / 10,
    k,
    targetPerWeek,
  };
}
