/**
 * IB-101 — «Где ликвидируют» shows the top rows and folds the rest behind «показать все».
 *
 * Pure, and applied AFTER `whereRows`. That order is the point: the ranking (by the period's
 * liquidation total), the one bar scale shared by every row, each row's verdict and the block's
 * totals are all computed over EVERY coin. Folding changes only how many rows are drawn, never a
 * number on them.
 *
 * Folds only when at least `minHidden` rows would go: with 9 or 10 coins everything is shown, so
 * there is never a button that hides a single row.
 */
export const WHERE_TOP_N = 8;
export const WHERE_MIN_HIDDEN = 3;

export interface Collapsed<T> {
  shown: readonly T[];
  hiddenCount: number;
  /** The liquidation total of exactly the hidden rows. */
  hiddenUsd: number;
}

export function collapseRows<T extends { usd: number }>(
  rows: readonly T[],
  n = WHERE_TOP_N,
  minHidden = WHERE_MIN_HIDDEN,
): Collapsed<T> {
  if (!(n >= 1) || !(minHidden >= 1)) throw new Error(`collapseRows: n and minHidden must be ≥ 1, got ${n}, ${minHidden}`);
  const hidden = rows.length - n;
  if (hidden < minHidden) return { shown: rows, hiddenCount: 0, hiddenUsd: 0 };
  return {
    shown: rows.slice(0, n),
    hiddenCount: hidden,
    hiddenUsd: rows.slice(n).reduce((sum, row) => sum + row.usd, 0),
  };
}
