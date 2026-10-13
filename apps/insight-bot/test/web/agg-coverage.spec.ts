/**
 * IB-056 — the aggregate-coverage block's arithmetic.
 */
import { aggCoverage, aggTotals } from '../../src/web/agg-coverage';
import type { AggCoverageRow } from '../../src/db/pg/agg-coverage-reads';

function row(over: Partial<AggCoverageRow> = {}): AggCoverageRow {
  return {
    symbol: 'BTCUSDT',
    market: 'perp',
    tf: '15m',
    held: 100,
    derivable: 0,
    unfetchable: 0,
    oldestDerivableMs: null,
    ...over,
  };
}

describe('aggCoverage', () => {
  it('leads with the largest derivable backlog, because that is the only column anyone acts on', () => {
    const views = aggCoverage([
      row({ symbol: 'ADAUSDT', derivable: 790 }),
      row({ symbol: 'ETHUSDT', derivable: 6358 }),
      row({ symbol: 'SOLUSDT', derivable: 0, unfetchable: 4 }),
    ]);

    expect(views.map((v) => v.symbol)).toEqual(['ETHUSDT', 'ADAUSDT', 'SOLUSDT']);
  });

  it('orders ties by series so the table does not reshuffle between requests', () => {
    const once = aggCoverage([
      row({ symbol: 'ETHUSDT', market: 'spot', derivable: 790 }),
      row({ symbol: 'ADAUSDT', market: 'perp', derivable: 790 }),
      row({ symbol: 'ADAUSDT', market: 'spot', derivable: 790 }),
    ]);
    const again = aggCoverage([
      row({ symbol: 'ADAUSDT', market: 'spot', derivable: 790 }),
      row({ symbol: 'ETHUSDT', market: 'spot', derivable: 790 }),
      row({ symbol: 'ADAUSDT', market: 'perp', derivable: 790 }),
    ]);

    expect(once.map((v) => `${v.symbol} ${v.market}`)).toEqual(['ADAUSDT perp', 'ADAUSDT spot', 'ETHUSDT spot']);
    expect(again).toEqual(once);
  });

  it('keeps spot and perp as separate rows: they are separate series in candles_agg', () => {
    const views = aggCoverage([
      row({ market: 'perp', held: 3549, derivable: 3382 }),
      row({ market: 'spot', held: 571, derivable: 6358 }),
    ]);

    expect(views).toHaveLength(2);
    expect(views.map((v) => v.market)).toEqual(['spot', 'perp']);
  });

  it('carries the oldest derivable bucket through as ms, or null', () => {
    const at = Date.UTC(2026, 7, 1);
    const views = aggCoverage([row({ derivable: 1, oldestDerivableMs: at }), row({ symbol: 'ADAUSDT' })]);

    expect(views[0].oldestDerivable).toBe(at);
    expect(views[1].oldestDerivable).toBeNull();
  });
});

describe('aggTotals', () => {
  it('reports the floor and the max, and no mean — the spread is the point', () => {
    // The 2026-10-12 figures: a mean of 16.7 over a population whose best member held 71.
    const totals = aggTotals(
      aggCoverage([
        row({ symbol: 'BTCUSDT', tf: '1d', held: 71 }),
        row({ symbol: 'ADAUSDT', tf: '1d', held: 12 }),
        row({ symbol: 'SOLUSDT', tf: '1d', held: 14 }),
      ]),
    );

    expect(totals).toEqual([{ tf: '1d', series: 3, derivable: 0, unfetchable: 0, heldFloor: 12, heldMax: 71 }]);
    // The mean would be 32.3 and would describe none of these three.
    expect(Object.keys(totals[0])).not.toContain('heldMean');
  });

  it('sums derivable and unfetchable per timeframe, worst timeframe first', () => {
    const totals = aggTotals(
      aggCoverage([
        row({ tf: '1h', derivable: 5, unfetchable: 1 }),
        row({ tf: '15m', symbol: 'A', derivable: 600 }),
        row({ tf: '15m', symbol: 'B', derivable: 400, unfetchable: 2 }),
      ]),
    );

    expect(totals.map((t) => [t.tf, t.derivable, t.unfetchable, t.series])).toEqual([
      ['15m', 1000, 2, 2],
      ['1h', 5, 1, 1],
    ]);
  });

  it('is empty rather than NaN or Infinity when there is nothing to summarise', () => {
    expect(aggTotals([])).toEqual([]);
  });

  it('never reports an infinite floor for a timeframe that exists', () => {
    const totals = aggTotals(aggCoverage([row({ tf: '4h', held: 0, derivable: 9 })]));
    expect(totals[0].heldFloor).toBe(0);
    expect(Number.isFinite(totals[0].heldFloor)).toBe(true);
  });
});
