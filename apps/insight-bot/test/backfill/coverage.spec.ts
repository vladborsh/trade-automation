import { buildSeriesCoverage, renderCoverageMarkdown, summariseMonths, type SeriesCoverageInput } from '../../src/backfill/coverage';

/**
 * IB-012 — the coverage report inherits IB-011's rule: a month the venue never served is not a
 * hole. Reporting it as one would put a permanent red line in front of the operator.
 */

const input = (over: Partial<SeriesCoverageInput> = {}): SeriesCoverageInput => ({
  symbol: 'ETHUSDT',
  series: 'open_interest_5m',
  monthsPresent: [],
  requestedFrom: '2021-10',
  requestedTo: '2022-01',
  rows: 0,
  ...over,
});

describe('buildSeriesCoverage', () => {
  it('months BELOW the venue\'s floor are unavailable, not missing', () => {
    // the OI archive 404s before 2021-12 for everything except BTC
    const c = buildSeriesCoverage(input({ servedFrom: '2021-12', monthsPresent: ['2021-12', '2022-01'], rows: 2 }));
    expect(c.unavailableMonths).toEqual(['2021-10', '2021-11']);
    expect(c.missingMonths).toEqual([]);
    expect(c.complete).toBe(true);
  });

  it('a month INSIDE the served window with no rows is a real hole', () => {
    const c = buildSeriesCoverage(input({ servedFrom: '2021-12', monthsPresent: ['2022-01'] }));
    expect(c.missingMonths).toEqual(['2021-12']);
    expect(c.complete).toBe(false);
  });

  it('without a known floor every requested month must be present', () => {
    const c = buildSeriesCoverage(input({ series: 'candles_1m_perp', monthsPresent: ['2021-10', '2021-11', '2021-12'] }));
    expect(c.unavailableMonths).toEqual([]);
    expect(c.missingMonths).toEqual(['2022-01']);
  });

  it('OKX\'s ~97-day window leaves years unavailable and still counts as complete', () => {
    const c = buildSeriesCoverage(input({
      series: 'funding_okx', requestedFrom: '2020-01', requestedTo: '2026-09',
      servedFrom: '2026-06', monthsPresent: ['2026-06', '2026-07', '2026-08', '2026-09'], rows: 294,
    }));
    expect(c.missingMonths).toEqual([]);
    expect(c.complete).toBe(true);
    expect(c.unavailableMonths).toHaveLength(77);
  });
});

describe('summariseMonths', () => {
  it('collapses consecutive months into runs so a long hole is one cell', () => {
    expect(summariseMonths(['2021-01', '2021-02', '2021-03', '2021-06'])).toBe('2021-01..2021-03, 2021-06');
    expect(summariseMonths(['2021-12', '2022-01'])).toBe('2021-12..2022-01'); // across the year
    expect(summariseMonths(['2021-05'])).toBe('2021-05');
    expect(summariseMonths([])).toBe('—');
  });
});

describe('renderCoverageMarkdown', () => {
  it('says plainly that a complete run is complete', () => {
    const md = renderCoverageMarkdown(
      [buildSeriesCoverage(input({ servedFrom: '2021-12', monthsPresent: ['2021-12', '2022-01'], rows: 2, firstRow: '2021-12-01', lastRow: '2022-01-31' }))],
      new Date('2026-09-28T00:00:00Z'),
    );
    expect(md).toContain('Every series is complete');
    expect(md).toContain('| ETHUSDT | open interest 5m | 2 | 2021-12-01 | 2022-01-31 | — | 2021-10..2021-11 |');
  });

  it('names the series that have real holes', () => {
    const md = renderCoverageMarkdown([buildSeriesCoverage(input({ monthsPresent: [] }))], new Date());
    expect(md).toContain('1 series have real holes');
    expect(md).toContain('ETHUSDT/open_interest_5m');
  });
});
