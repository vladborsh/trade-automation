/**
 * D2 — "how unusual", on one scale for every rule: the empirical percentile of `value` within the
 * rule's own reference sample, by MID-RANK — (count below + half the count equal) ÷ n.
 *
 * Mid-rank, not "share at or below", because the liquidation samples are zero-heavy: with 90 % of
 * hours at 0, "≤" would rate a quiet 0-hour as 0.90 — exactly the show threshold — and the page
 * would flag silence as an outlier. Mid-rank rates it 0.45. It also survives where a z-score
 * explodes (IB-015's 1.4e14).
 *
 * Null for an empty sample: no reference, no rarity — never a default.
 */
export function rarity(value: number, sample: readonly number[]): number | null {
  if (sample.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const s of sample) {
    if (s < value) below++;
    else if (s === value) equal++;
  }
  return (below + equal / 2) / sample.length;
}

/** IB-085/086 — two-sided forms of `rarity`, for changes and for levels (D2). */
/** Two-sided rarity of a CHANGE: |current| within |past changes|. */
export function changeRarity(current: number, pastChanges: readonly number[]): number | null {
  return rarity(Math.abs(current), pastChanges.map(Math.abs));
}

/** Two-sided rarity of a LEVEL: |current − median| within |past − median|. */
export function levelRarity(current: number, pastLevels: readonly number[]): number | null {
  if (pastLevels.length === 0) return null;
  const sorted = [...pastLevels].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return rarity(Math.abs(current - median), pastLevels.map((v) => Math.abs(v - median)));
}
