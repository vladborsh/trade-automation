import { coverageCounts, toCoverageViews } from './coverage.rows';

const rows = [
  { symbol: 'BTCUSDT', series: 'candles_1m', firstRow: Date.UTC(2024, 0, 1), lastRow: Date.UTC(2026, 8, 28), missingMonths: [] },
  { symbol: 'ETHUSDT', series: 'candles_1m', firstRow: Date.UTC(2024, 0, 1), lastRow: Date.UTC(2026, 8, 28), missingMonths: ['2025-03'] },
  { symbol: 'SOLUSDT', series: 'open_interest_5m', firstRow: null, lastRow: null, missingMonths: [] },
];

describe('toCoverageViews', () => {
  it('sorts the rows worth acting on first: empty, then holes, then complete', () => {
    expect(toCoverageViews(rows).map((r) => r.symbol)).toEqual(['SOLUSDT', 'ETHUSDT', 'BTCUSDT']);
  });

  it('labels an empty series with a dash rather than the epoch', () => {
    const [empty] = toCoverageViews(rows);
    expect(empty.firstLabel).toBe('—');
    expect(empty.lastLabel).toBe('—');
    expect(empty.state).toBe('empty');
  });

  it('renders the stored bounds as ISO days', () => {
    const btc = toCoverageViews(rows).find((r) => r.symbol === 'BTCUSDT');
    expect(btc?.firstLabel).toBe('2024-01-01');
    expect(btc?.lastLabel).toBe('2026-09-28');
    expect(btc?.state).toBe('complete');
  });

  it('distinguishes a series with holes from a complete one', () => {
    expect(toCoverageViews(rows).find((r) => r.symbol === 'ETHUSDT')?.state).toBe('holes');
  });
});

describe('coverageCounts', () => {
  it('counts the total, the empty and the holed — the three numbers the summary needs', () => {
    expect(coverageCounts(toCoverageViews(rows))).toEqual({ total: 3, empty: 1, holes: 1 });
  });

  it('reports a complete set as no problems, rather than as a sentence', () => {
    // §11: the counts are pure, the sentence lives in the string table
    expect(coverageCounts(toCoverageViews([rows[0]]))).toEqual({ total: 1, empty: 0, holes: 0 });
  });

  it('counts nothing as nothing', () => {
    expect(coverageCounts([])).toEqual({ total: 0, empty: 0, holes: 0 });
  });
});
