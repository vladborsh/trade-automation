import { ArchiveParseError, parseFunding, parseKlines, parseMetrics } from '../src/archive/archive-rows';

/** IB-012 §5 — the three archive layouts. */

describe('parseKlines', () => {
  const line = '1735689600000,93000.1,93100.2,92900.3,93050.4,12.5,1735689659999,1163000.5,420,6.25,581500.25,0';

  it('reads a row and reports the file\'s unit', () => {
    const { rows, unit } = parseKlines(`${line}\n`);
    expect(unit).toBe('ms');
    expect(rows).toEqual([{
      openTime: new Date('2025-01-01T00:00:00.000Z'),
      open: 93000.1, high: 93100.2, low: 92900.3, close: 93050.4, volume: 12.5,
      quoteVolume: 1163000.5, trades: 420, takerBuyVolume: 6.25, takerBuyQuoteVolume: 581500.25,
    }]);
  });

  it('reads a microsecond (2025-01 spot) file to the same instant', () => {
    const us = line.replace('1735689600000,', '1735689600000000,').replace(',1735689659999,', ',1735689659999000,');
    expect(parseKlines(us).rows[0].openTime).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    expect(parseKlines(us).unit).toBe('us');
  });

  it('an EMPTY price is an error, not a zero (the IB-008 bug)', () => {
    expect(() => parseKlines('1735689600000,,93100.2,92900.3,93050.4,12.5')).toThrow(ArchiveParseError);
  });

  it('a missing optional column is null, not zero', () => {
    const { rows } = parseKlines('1735689600000,1,1,1,1,1,1735689659999');
    expect(rows[0].quoteVolume).toBeNull();
    expect(rows[0].trades).toBeNull();
  });
});

describe('parseFunding', () => {
  it('reads the settlement time and rate, skipping the interval column', () => {
    expect(parseFunding('calc_time,funding_interval_hours,last_funding_rate\n1735689600000,8,0.0001\n')).toEqual([
      { fundingTime: new Date('2025-01-01T00:00:00.000Z'), rate: 0.0001 },
    ]);
  });

  it('keeps a negative rate (the sign is the signal)', () => {
    expect(parseFunding('1735689600000,8,-0.00075')[0].rate).toBe(-0.00075);
  });
});

describe('parseMetrics', () => {
  // create_time is a formatted datetime here, NOT an epoch — the one way metrics differ
  const line = '2026-09-27 00:05:00,BTCUSDT,81234.5,7650000000,1.85,2.10,0.95,1.23';

  it('maps the four ratio columns to the four kinds the schema names', () => {
    expect(parseMetrics(line)).toEqual([{
      ts: new Date('2026-09-27T00:05:00.000Z'),
      oiBase: 81234.5,
      oiQuote: 7650000000,
      topAccountLongShort: 1.85,   // count_toptrader_long_short_ratio
      topPositionLongShort: 2.10,  // sum_toptrader_long_short_ratio
      globalAccountLongShort: 0.95, // count_long_short_ratio
      takerLongShort: 1.23,        // sum_taker_long_short_vol_ratio
    }]);
  });

  it('treats the naive timestamp as UTC, not as the machine\'s zone', () => {
    expect(parseMetrics(line)[0].ts.toISOString()).toBe('2026-09-27T00:05:00.000Z');
  });

  it('refuses a corrupt timestamp mid-file rather than storing an Invalid Date', () => {
    expect(() => parseMetrics(`${line}\n2026-13-45 99:99:99,BTCUSDT,1,2,3,4,5,6`)).toThrow(ArchiveParseError);
  });
});
