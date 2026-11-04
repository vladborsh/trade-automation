import type { WebLiquidationBlock } from '@trade-automation/contracts';

/**
 * IB-BUG-025 — «прочие монеты (N): $X · не в списке»: the crypto in the block's total that is in
 * no row of «Где ликвидируют» (universe coins below the rows, and coins the universe does not
 * list). It sits after the rows and outside IB-101's fold, so it is visible folded or not, and it
 * never overlaps «ещё K монет · $Y», which is the folded rows only: rows + other = the total.
 * Null when there is nothing to state.
 */
export interface OtherLine {
  coins: number;
  usd: number;
}

export function otherLine(other: WebLiquidationBlock['otherCoins'] | null | undefined): OtherLine | null {
  if (!other || other.totals.usd <= 0 || other.coins <= 0) return null;
  return { coins: other.coins, usd: other.totals.usd };
}
