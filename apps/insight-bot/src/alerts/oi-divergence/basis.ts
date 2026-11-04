import { barsForEvaluation, type DivergenceParams } from '../../insights/divergence/detector';
import { nearMissReach } from '../../insights/divergence/diagnose';

type Reach = Pick<DivergenceParams, 'n' | 'k' | 'w'>;

/**
 * IB-112 (V7, V10; TL and dev-1, 2026-11-04), extended in IB-114 — how many closed bars the loop reads and which
 * B it trusts. Every count is derived from the detector's `barsForEvaluation(params)` =
 * max(W + max(N, ATR_PERIOD − N − 1), OI_MEDIAN_BARS + 1, ATR_PERIOD) + k + N + 1 (113 / 185 / 111 on
 * 15m / 1h / 4h with the round-2 defaults). Never a typed number.
 *
 * **What it reads: `barsForEvaluation + W`** (209 / 353 / 201 in IB-114; IB-115 widens the basis to the near-miss
 * reach, `barsToFetch` below → 260 / 440 / 245; 100–499 bars is 2 weight per kline call, as
 * before). `barsForEvaluation` alone judges the newest B on a full basis, but not its RUN (V8): a repeat's
 * earlier B′ lies between A and B, i.e. up to W bars before B, and the detector only knows A–B′ was a line if
 * B′ itself was judged — which needs `barsForEvaluation` bars before B′. With fewer, the window called B a first
 * alert (run 2) where the chart, on all history, draws «третий подряд» (run 3): found by the window-vs-history
 * spec once IB-114's tolerances admitted more lines (two 4h random walks, B′ at window index 63 and 84 < 101).
 *
 * **What it needs to evaluate at all: `barsForEvaluation`.** A coin younger than the extra W bars has no
 * earlier history on the venue either, so its run is complete in what it has.
 *
 * **Which B it sends:** the detector judges a B with its 100 OI moves present, but it will still pair a B whose
 * farthest A lies before the window with a NEARER A. The loop keeps only the newest confirmable position,
 * index ≥ length − (k + N + 1), and never one before the full-basis index `barsForEvaluation − (k + N + 1)`.
 * Older Bs in the window were the newest at an earlier evaluation; the journal's unique key absorbs repeats.
 */
export function barsToFetch(p: Reach): number {
  return Math.max(barsForEvaluation(p), barsForEvaluation(nearMissReach(p))) + p.w;
}

/**
 * IB-115 (V26): near-misses reach farther — A up to ⌊1.5 W⌋ back, an OI pivot up to 2k away — so the BASIS is
 * `barsForEvaluation(nearMissReach(p))` (164 / 272 / 155). The repeat tail stays the alert's + W (V10, TL
 * 2026-11-04): near-misses need no repeat replay of their own, and a 1.5 W tail would put 1h at ≈ 524 bars,
 * weight 5. So the loop reads 260 / 440 / 245 bars, all weight 2 (limit < 500).
 */
export function minBarsForNearMisses(p: Reach): number {
  return barsForEvaluation(nearMissReach(p));
}

export function minBarsToEvaluate(p: Reach): number {
  return barsForEvaluation(p);
}

/** The first bar index, in a window of `length` closed bars, whose B the loop may journal. */
export function fullBasisIndex(p: Reach, length: number): number {
  const tail = p.k + p.n + 1;
  return Math.max(barsForEvaluation(p) - tail, length - tail);
}

export function hasFullBasis(bIndex: number, p: Reach, length: number): boolean {
  return bIndex >= fullBasisIndex(p, length);
}
