import { cellLabel, cellSeverity, toGapGrid, worstCells } from './gap-grid.mapper';

const response = {
  days: ['2026-09-27', '2026-09-26', '2026-09-28'], // deliberately unsorted
  cells: [
    { day: '2026-09-26', symbol: 'BTCUSDT', series: 'candles_1m', missing: 0, expected: 1440 },
    { day: '2026-09-27', symbol: 'BTCUSDT', series: 'candles_1m', missing: 3, expected: 1440 },
    { day: '2026-09-27', symbol: 'BTCUSDT', series: 'open_interest_5m', missing: 2, expected: 288 },
    { day: '2026-09-27', symbol: 'ETHUSDT', series: 'candles_1m', missing: 400, expected: 1440 },
  ],
};

describe('toGapGrid', () => {
  it('orders the days chronologically, whatever order the API returned them in', () => {
    expect(toGapGrid(response).days).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
  });

  it('sums the series of one (symbol, day) into a single cell', () => {
    const btc = toGapGrid(response).rows.find((r) => r.symbol === 'BTCUSDT');
    expect(btc?.cells.find((c) => c.day === '2026-09-27')).toEqual({
      day: '2026-09-27', missing: 5, expected: 1728, known: true,
    });
  });

  it('marks a day no report covered as unknown, not as clean', () => {
    const btc = toGapGrid(response).rows.find((r) => r.symbol === 'BTCUSDT');
    const cell = btc?.cells.find((c) => c.day === '2026-09-28');
    expect(cell).toMatchObject({ known: false, missing: 0 });
    expect(cellSeverity(cell!)).toBe('unknown');
    expect(cellLabel(cell!)).toBe('?');
    // the distinction is the point: '?' must never read as a clean day
    expect(cellLabel({ day: 'x', missing: 0, expected: 10, known: true })).toBe('·');
  });

  it('puts the worst symbol first so a bad day is visible without reading the grid', () => {
    expect(toGapGrid(response).rows.map((r) => r.symbol)).toEqual(['ETHUSDT', 'BTCUSDT']);
  });

  it('calls a hole over 1 % of the day bad, and a smaller one minor', () => {
    expect(cellSeverity({ day: 'd', missing: 400, expected: 1440, known: true })).toBe('bad');
    expect(cellSeverity({ day: 'd', missing: 5, expected: 1728, known: true })).toBe('minor');
    expect(cellSeverity({ day: 'd', missing: 0, expected: 1440, known: true })).toBe('clean');
  });

  it('never divides by a zero expectation', () => {
    expect(cellSeverity({ day: 'd', missing: 4, expected: 0, known: true })).toBe('minor');
  });

  it('lists only the cells that actually lost data, biggest first', () => {
    const worst = worstCells(toGapGrid(response));
    expect(worst.map((c) => [c.symbol, c.missing])).toEqual([
      ['ETHUSDT', 400],
      ['BTCUSDT', 5],
    ]);
  });

  it('returns an empty grid rather than throwing when nothing is reported', () => {
    expect(toGapGrid({ days: [], cells: [] })).toEqual({ days: [], rows: [] });
  });
});
