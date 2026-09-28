/**
 * IB-015 — the percentile used by `funding.<venue>.pct30d` and `ls.*.pct30d` (§8.2).
 *
 * Shared because "the project's positioning convention" has to mean one thing. Two decisions
 * are baked in, and both exist so a percentile never overstates what it knows:
 *
 * - **`minPeriods`.** Below it the answer is `null`, not a number. A percentile of the last
 *   three settlements is arithmetic, not information, and a playbook comparing it to 0.9 would
 *   be acting on noise.
 * - **The rank is inclusive of ties** (`≤ value`), the ordinary "percentile rank" definition.
 *   With funding this matters: long runs of identical rates are normal on a quiet venue, and
 *   excluding ties would put a rate at the 0th percentile purely because it equals its
 *   neighbours.
 */

export interface PercentileOptions {
  minPeriods: number;
  /** Keep only the most recent N samples before ranking; omit to use all of them. */
  window?: number;
}

/**
 * The percentile rank of `value` within `samples`, in [0, 1], or `null` when there is not
 * enough history.
 *
 * `samples` is oldest-first; only the last `window` are considered. `value` is normally the
 * latest sample, but is passed separately so a caller can rank a candidate that is not yet in
 * the series.
 */
export function percentileRank(
  value: number | null,
  samples: readonly number[],
  options: PercentileOptions,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;

  const usable = (options.window === undefined ? samples : samples.slice(-options.window))
    .filter((s) => Number.isFinite(s));
  if (usable.length < options.minPeriods) return null;

  const atOrBelow = usable.reduce((n, s) => n + (s <= value ? 1 : 0), 0);
  return atOrBelow / usable.length;
}

/**
 * Sample standard deviation (n − 1). Returns null below two samples, and — deliberately — when
 * the deviation is zero: a z-score against a flat series is a division by zero dressed up as
 * infinity, and `null` is the honest answer.
 */
export function stdDev(samples: readonly number[]): number | null {
  const usable = samples.filter((s) => Number.isFinite(s));
  if (usable.length < 2) return null;
  const mean = usable.reduce((a, b) => a + b, 0) / usable.length;
  const variance = usable.reduce((a, b) => a + (b - mean) ** 2, 0) / (usable.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? sd : null;
}

export function mean(samples: readonly number[]): number | null {
  const usable = samples.filter((s) => Number.isFinite(s));
  return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0) / usable.length;
}

/**
 * A z-score, `null` when the inputs cannot support one. Used by `liq.*.z60m`, which §8.2 also
 * requires to be log1p-transformed first — the transform is the caller's, because it is part of
 * that feature's definition rather than of z-scoring.
 */
export function zScore(value: number | null, samples: readonly number[]): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const m = mean(samples);
  const sd = stdDev(samples);
  if (m === null || sd === null) return null;
  return (value - m) / sd;
}
