import type { WebLiquidationBlock, WebLiquidationCoinPeriod } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import blockFixture from '../../../../../../../../libs/contracts/test/fixtures/liquidation-block.24h.json';
import { whereRows } from './liq-layout';
import { collapseRows, WHERE_MIN_HIDDEN, WHERE_TOP_N } from './liq-where-collapse';

/**
 * IB-101 — the where-block folds to the top 8 coins. The cases the row names, plus the one that
 * matters most: folding changes how many rows are drawn, never a number ON them.
 */

const block = blockFixture as unknown as WebLiquidationBlock;

/** n coins with distinct totals (descending), cloned from the fixture's first coin. */
function coins(n: number): WebLiquidationCoinPeriod[] {
  const base = block.perCoin[0];
  return Array.from({ length: n }, (_, i) => {
    const usd = (n - i) * 1000;
    return { ...base, symbol: `C${i}USDT`, base: `C${i}`, totals: { ...base.totals, usd, long: usd * 0.25, short: usd * 0.75 } };
  });
}
const rowsOf = (n: number) => whereRows(coins(n)).rows;

describe('collapseRows — when to fold', () => {
  it('the defaults are the row\'s: top 8, and only when at least 3 would hide', () => {
    expect([WHERE_TOP_N, WHERE_MIN_HIDDEN]).toEqual([8, 3]);
  });

  it.each([1, 8, 9, 10])('%i rows → all shown, no button (never a button that hides 1–2 rows)', (n) => {
    const c = collapseRows(rowsOf(n));
    expect(c.shown).toHaveLength(n);
    expect(c.hiddenCount).toBe(0);
    expect(c.hiddenUsd).toBe(0);
  });

  it('11 rows → the top 8, and «ещё 3»', () => {
    const c = collapseRows(rowsOf(11));
    expect(c.shown.map((r) => r.base)).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(c.hiddenCount).toBe(3);
  });

  it('hiddenUsd is the total of exactly the hidden rows — not of the shown ones, not of all', () => {
    const rows = rowsOf(12);
    const c = collapseRows(rows);
    expect(c.hiddenUsd).toBe((4 + 3 + 2 + 1) * 1000); // C8..C11
    expect(c.shown.reduce((s, r) => s + r.usd, 0) + c.hiddenUsd).toBe(rows.reduce((s, r) => s + r.usd, 0));
  });

  it('refuses a nonsense size instead of showing nothing', () => {
    expect(() => collapseRows(rowsOf(12), 0)).toThrow();
  });
});

describe('folding changes no number on a shown row (verdict, bar scale and totals come from ALL rows)', () => {
  it('a shown row is the very same row whereRows made over every coin: same bar %, same verdict', () => {
    const rows = rowsOf(12);
    const c = collapseRows(rows);
    c.shown.forEach((row, i) => expect(row).toBe(rows[i]));
    // the scale is the widest side among ALL coins (C0's short), so the top row still reaches 100 %
    expect(c.shown[0].shortPct).toBe(100);
  });

  it('the block\'s totals do not change when the rows fold: the fold reads them, never recomputes them', () => {
    const rows = rowsOf(12);
    const before = rows.map((r) => ({ ...r }));
    collapseRows(rows);
    expect(rows).toEqual(before); // nothing mutated, so every total computed from them is unchanged
  });
});
