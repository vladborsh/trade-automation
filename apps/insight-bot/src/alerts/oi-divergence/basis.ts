import { barsForEvaluation, type DivergenceParams } from '../../insights/divergence/detector';

/**
 * IB-112 (V7, V10; TL and dev-1, 2026-11-04) — how many closed bars the loop reads and which B it
 * trusts. One rule, owned by the detector: `barsForEvaluation(params)` (IB-110, a314860) =
 * max(W + N, OI_MEDIAN_BARS + 1, ATR_PERIOD) + k + N + 1 → 112 / 136 / 111 on 15m / 1h / 4h with
 * the defaults. Never a typed number. 100–499 bars is 2 weight per kline call.
 *
 * The detector judges a B with its 100 OI moves present, but it will still pair a B whose farthest A
 * lies before the window with a NEARER A. The loop sends alerts, so it keeps only Bs whose full
 * basis is inside what it read: index ≥ count − (k + N + 1), the position of the newest confirmable
 * B in a window of exactly `barsForEvaluation` bars.
 */
export function barsToFetch(p: Pick<DivergenceParams, 'n' | 'k' | 'w'>): number {
  return barsForEvaluation(p);
}

export function fullBasisIndex(p: Pick<DivergenceParams, 'n' | 'k' | 'w'>): number {
  return barsForEvaluation(p) - (p.k + p.n + 1);
}

export function hasFullBasis(bIndex: number, p: Pick<DivergenceParams, 'n' | 'k' | 'w'>): boolean {
  return bIndex >= fullBasisIndex(p);
}
