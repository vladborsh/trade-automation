import type { WebLiquidationCoinPeriod } from '@trade-automation/contracts';
import { whereRows } from './liq-layout';
import { collapseRows } from './liq-where-collapse';
import { otherLine } from './liq-where-other';

/** IB-BUG-025 — the «прочие монеты» line beside IB-101's fold. */
const zero = { usd: 0, long: 0, short: 0, events: 0 };
const basis = { periodDays: 0, windowsInPeriod: 0, windowsObserved: 0, venues: [], unavailable: 'insufficient_history' as const };
const coin = (i: number, usd: number): WebLiquidationCoinPeriod => ({
  symbol: `C${i}USDT`, base: `C${i}`, totals: { usd, long: usd / 2, short: usd / 2, events: 1 }, verdict: null, basis,
});

describe('otherLine (IB-BUG-025)', () => {
  it('states the crypto in no row, and nothing when there is none', () => {
    expect(otherLine({ totals: { usd: 6_900_000, long: 4e6, short: 2.9e6, events: 9_772 }, coins: 491 })).toEqual({ coins: 491, usd: 6_900_000 });
    expect(otherLine({ totals: zero, coins: 0 })).toBeNull();
    expect(otherLine(null)).toBeNull();
  });

  it('NEVER DOUBLE-COUNTS with the fold: shown + «ещё» (folded rows only) + other = the block total', () => {
    const perCoin = Array.from({ length: 12 }, (_, i) => coin(i, 1_000 * (12 - i)));
    const other = { totals: { usd: 5_000, long: 2_500, short: 2_500, events: 4 }, coins: 3 };
    const total = perCoin.reduce((s, c) => s + c.totals.usd, 0) + other.totals.usd;
    const rows = whereRows(perCoin).rows;
    const folded = collapseRows(rows);
    const shown = folded.shown.reduce((s, r) => s + r.usd, 0);
    expect(folded.hiddenCount).toBe(4);
    expect(shown + folded.hiddenUsd + (otherLine(other)?.usd ?? 0)).toBe(total);
    // the fold's «ещё» is the folded ROWS only: it does not include the other coins
    expect(folded.hiddenUsd).toBe(perCoin.slice(8).reduce((s, c) => s + c.totals.usd, 0));
  });
});
