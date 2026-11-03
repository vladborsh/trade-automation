import { gapRow } from '../../../src/collectors/binance-common/rows';

/** IB-005 — a GapRepair hole → collector_gaps row. */

describe('gapRow (§3.3, §6.2)', () => {
  it('maps a repaired hole', () => {
    const detectedAt = new Date(1_727_481_720_000);
    expect(gapRow({
      stream: 'binance:perp:kline_1m', market: 'perp', symbol: 'BTCUSDT',
      from: 1_727_481_600_000, to: 1_727_481_660_000, expected: 2, repaired: 2, detectedAt,
    })).toEqual({
      stream: 'binance:perp:kline_1m', venue: 'binance', market: 'perp', symbol: 'BTCUSDT',
      gapFrom: new Date(1_727_481_600_000), gapTo: new Date(1_727_481_660_000),
      expected: 2, repaired: 2, error: null, detectedAt,
    });
  });

  it('an unrepairable hole keeps its error and repaired 0 — degraded forceOrder is written this way', () => {
    const row = gapRow({
      stream: 'binance:perp:forceOrder', market: 'perp', symbol: null,
      from: 1, to: 2, expected: 0, repaired: 0, error: 'degraded mode: no REST equivalent', detectedAt: new Date(3),
    });
    expect([row.symbol, row.repaired, row.error]).toEqual([null, 0, 'degraded mode: no REST equivalent']);
  });
});
