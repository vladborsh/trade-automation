import {
  isSidednessDrift,
  mapMarkPriceKline,
  mapOpenInterestRow,
  mapTicker,
} from '../../../src/market-data/metrics/bybit/bybit-metrics.mapper';

describe('Bybit metrics mapper (architecture/aggregate-oi.md §0, §2, §4)', () => {
  it('history row: value = singleOpenInterest (one-sided), unit base, venue stamp, no notional', () => {
    const o = mapOpenInterestRow('bybit:BTCUSDT', 'openInterest', {
      openInterest: '56711.59900000',
      singleOpenInterest: '28355.8',
      timestamp: '1789731600000',
    });
    expect(o).toEqual({
      metric: 'openInterest',
      instrument: 'bybit:BTCUSDT',
      time: 1_789_731_600_000,
      value: 28_355.8,
      unit: 'base',
    });
  });

  it('mark-price bar → price point stamped at the bar CLOSE (start + 5 m), price = close', () => {
    expect(mapMarkPriceKline(['1789731300000', '78081.9', '78146', '78081.8', '78099.1'])).toEqual({
      time: 1_789_731_600_000,
      price: 78_099.1,
    });
  });

  it('ticker: value single, notional = single × markPrice (basis derived, = singleOpenInterestValue), time = the response time', () => {
    const o = mapTicker('bybit:BTCUSDT', 'openInterest', 1_789_731_656_326, {
      symbol: 'BTCUSDT',
      markPrice: '78081.42',
      openInterest: '56715.046',
      singleOpenInterest: '28357.523',
      singleOpenInterestValue: '2214195663.52',
    });
    expect(o).toEqual({
      metric: 'openInterest',
      instrument: 'bybit:BTCUSDT',
      time: 1_789_731_656_326,
      value: 28_357.523,
      unit: 'base',
      notional: 28_357.523 * 78_081.42,
      notionalBasis: 'derived',
    });
  });

  describe('sidedness drift guard (§2: openInterest / singleOpenInterest must be 2 ± 0.001)', () => {
    it.each([
      ['56711.599', '28355.8', false], // live row, ratio 2.00000003
      ['200.09', '100', false], // 2.0009 — inside the tolerance
      ['200.2', '100', true], // 2.002
      ['100', '100', true], // Bybit made the legacy field one-sided
      ['0', '0', false], // no positions: no ratio, no drift
      ['5', '0', true],
      ['abc', '1', true],
    ])('openInterest %s / single %s → drift %s', (both, single, drift) => {
      expect(isSidednessDrift(both, single)).toBe(drift);
    });
  });
});
