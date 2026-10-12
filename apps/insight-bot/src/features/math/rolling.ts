/**
 * IB-015 — the two rolling statistics §8.2 needs, and neither exists in the monorepo.
 *
 * `libs/indicators` has no percentile and no z-score; the only standard deviation is inlined
 * inside Bollinger. Both functions here return `null` rather than a number when the sample
 * cannot support one, because the frame's contract is that a key which cannot be computed is
 * **not zero** — a funding percentile with no history is not a percentile of zero, and a
 * liquidation z-score over a flat window is not a z-score of zero.
 */

/**
 * The fraction of `sample` at or below `value`, in `[0, 1]`, or `null` under `minPeriods`.
 *
 * §8.2's positioning convention: "percentile of the last settled rate among the venue's last 90
 * settlements (`min_periods` 45)". Rank-based, counting ties as at-or-below — so a venue whose
 * rate equals its own maximum reads 1.0 rather than something just under it, which is the answer
 * the `pct30d ≥ 0.90` test in the funding-family definition expects.
 *
 * `minPeriods` is not advisory. Below it the answer is `null`: a percentile over eleven
 * observations is a number, but it is not the number §8.2 defines, and the difference is
 * invisible once it reaches a card.
 */
export function percentileOf(
  sample: readonly number[],
  value: number,
  minPeriods: number,
): number | null {
  if (sample.length < minPeriods) return null;
  let atOrBelow = 0;
  for (const x of sample) if (x <= value) atOrBelow += 1;
  return atOrBelow / sample.length;
}

/** Population mean and standard deviation, the convention already used in `bollinger.ts`. */
export function meanAndSd(sample: readonly number[]): { mean: number; sd: number } {
  const n = sample.length;
  let sum = 0;
  for (const x of sample) sum += x;
  const mean = sum / n;
  // from the deviations rather than a running sum of squares, so large values keep precision
  let sq = 0;
  for (const x of sample) sq += (x - mean) ** 2;
  return { mean, sd: Math.sqrt(sq / n) };
}

/**
 * `(log1p(value) − mean) / sd` over the log1p-transformed sample — §8.2's `liq.*.z60m`.
 *
 * Transformed before the statistics, not after: liquidation sums are heavy-tailed and bounded
 * below by zero, so a z-score of the raw sums is dominated by a handful of cascades and reads
 * "normal" for everything else. `log1p` is chosen over `log` because a quiet window is a real
 * zero and `log(0)` is not a number.
 *
 * Two refusals:
 *
 * - **under `minSamples`** — §8.2 says `null` until 14 days of liquidation history exist, and
 *   the caller converts that to a sample count;
 * - **`sd === 0`** — every window in the sample held the same amount, so "how unusual is this"
 *   has no denominator. Reporting 0 would say "exactly normal" about a measurement that does not
 *   exist, which is the same mistake as IB-038's median-of-zero.
 */
export function log1pZScore(
  sample: readonly number[],
  value: number,
  minSamples: number,
): number | null {
  if (sample.length < minSamples) return null;
  const transformed = sample.map((x) => Math.log1p(x));
  const { mean, sd } = meanAndSd(transformed);
  if (sd === 0) return null;
  return (Math.log1p(value) - mean) / sd;
}
