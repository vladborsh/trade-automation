import type { WebAggCoverage } from '@trade-automation/contracts';
import { AGG_ROW_LIMIT, aggTotals, heldFloorByTf, hiddenAggCount, toAggViews, visibleAggRows } from './agg-rows';

function row(over: Partial<WebAggCoverage> = {}): WebAggCoverage {
  return {
    symbol: 'BTCUSDT',
    market: 'perp',
    tf: '15m',
    held: 100,
    derivable: 0,
    unfetchable: 0,
    oldestDerivable: null,
    ...over,
  };
}

describe('toAggViews', () => {
  it('puts the series someone can fix first, and the ones nobody can fix last', () => {
    const views = toAggViews([
      row({ symbol: 'AAA', derivable: 0, unfetchable: 5 }),
      row({ symbol: 'BBB', derivable: 0, unfetchable: 0 }),
      row({ symbol: 'CCC', derivable: 12 }),
    ]);

    expect(views.map((v) => [v.symbol, v.state])).toEqual([
      ['CCC', 'derivable'],
      ['AAA', 'unfetchable'],
      ['BBB', 'ok'],
    ]);
  });

  it('spells the series with its market, because the symbol alone is two different series', () => {
    const views = toAggViews([row({ market: 'spot', derivable: 1 }), row({ market: 'perp', derivable: 2 })]);

    expect(views.map((v) => v.seriesLabel)).toEqual(['BTCUSDT perp', 'BTCUSDT spot']);
  });

  it('labels the oldest derivable bucket to the minute, and an absent one as a dash', () => {
    const views = toAggViews([
      row({ derivable: 1, oldestDerivable: Date.UTC(2026, 7, 1, 0, 0) }),
      row({ symbol: 'AAA' }),
    ]);

    expect(views[0].oldestDerivableLabel).toBe('2026-08-01 00:00');
    expect(views[1].oldestDerivableLabel).toBe('—');
  });

  it('is stable: the same rows in a different order give the same table', () => {
    const a = toAggViews([row({ symbol: 'AAA', derivable: 5 }), row({ symbol: 'BBB', derivable: 5 })]);
    const b = toAggViews([row({ symbol: 'BBB', derivable: 5 }), row({ symbol: 'AAA', derivable: 5 })]);

    expect(b).toEqual(a);
  });
});

describe('aggTotals', () => {
  it('counts the breadth of the gap beside its depth', () => {
    const totals = aggTotals([
      row({ symbol: 'AAA', derivable: 6358 }),
      row({ symbol: 'BBB', derivable: 790 }),
      row({ symbol: 'CCC', derivable: 0, unfetchable: 4 }),
    ]);

    expect(totals).toEqual({
      series: 3,
      derivable: 7148,
      unfetchable: 4,
      seriesWithGap: 2,
      oldestDerivable: null,
    });
  });

  it('takes the oldest derivable bucket across every series, ignoring the nulls', () => {
    const older = Date.UTC(2026, 7, 1);
    const newer = Date.UTC(2026, 8, 28);
    const totals = aggTotals([
      row({ symbol: 'AAA', derivable: 1, oldestDerivable: newer }),
      row({ symbol: 'BBB', derivable: 1, oldestDerivable: older }),
      row({ symbol: 'CCC' }),
    ]);

    expect(totals.oldestDerivable).toBe(older);
  });

  it('reports nothing rather than zero when there are no series', () => {
    expect(aggTotals([])).toEqual({ series: 0, derivable: 0, unfetchable: 0, seriesWithGap: 0, oldestDerivable: null });
  });
});

describe('heldFloorByTf', () => {
  it('gives the floor and the max per timeframe, and no mean', () => {
    // The 2026-10-12 1d figures: mean 16.7, floor 12, and BTC — the symbol under test — at 71.
    const floors = heldFloorByTf([
      row({ tf: '1d', symbol: 'BTCUSDT', held: 71 }),
      row({ tf: '1d', symbol: 'ADAUSDT', held: 12 }),
      row({ tf: '1d', symbol: 'SOLUSDT', held: 14 }),
      row({ tf: '15m', held: 3549 }),
    ]);

    expect(floors).toEqual([
      { tf: '15m', heldFloor: 3549, heldMax: 3549 },
      { tf: '1d', heldFloor: 12, heldMax: 71 },
    ]);
  });

  it('is empty for no rows, so the block can hide rather than show an empty table', () => {
    expect(heldFloorByTf([])).toEqual([]);
  });
});

describe('visibleAggRows', () => {
  const many = (n: number, over: Partial<WebAggCoverage> = {}) =>
    toAggViews(Array.from({ length: n }, (_, i) => row({ symbol: `S${String(i).padStart(3, '0')}`, ...over })));

  it('omits the rows with nothing to act on, however many there are', () => {
    const views = toAggViews([
      row({ symbol: 'AAA', derivable: 5 }),
      row({ symbol: 'BBB' }),
      row({ symbol: 'CCC' }),
    ]);

    expect(visibleAggRows(views).map((v) => v.symbol)).toEqual(['AAA']);
    expect(hiddenAggCount(views)).toBe(2);
  });

  it('caps a long list, because a table nobody reads is as latent as a command nobody runs', () => {
    const views = many(240, { derivable: 7 });

    expect(visibleAggRows(views)).toHaveLength(AGG_ROW_LIMIT);
    expect(hiddenAggCount(views)).toBe(240 - AGG_ROW_LIMIT);
  });

  it('keeps the worst rows when it caps, never an arbitrary slice', () => {
    const views = toAggViews([
      ...Array.from({ length: 30 }, (_, i) => row({ symbol: `S${i}`, derivable: 1 })),
      row({ symbol: 'WORST', derivable: 9999 }),
    ]);

    expect(visibleAggRows(views)[0].symbol).toBe('WORST');
  });

  it('hides nothing when everything fits and everything is actionable', () => {
    const views = many(3, { derivable: 1 });
    expect(visibleAggRows(views)).toHaveLength(3);
    expect(hiddenAggCount(views)).toBe(0);
  });
});
