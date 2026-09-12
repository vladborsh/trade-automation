import {
  BinanceOpenInterestHistRow,
  BinanceOpenInterestSnapshot,
  mapOpenInterestHistRow,
  mapOpenInterestSnapshot,
} from '../../../src/market-data/metrics/binance/binance-metrics.mapper';

// Fixture shapes taken from a live request against fapi.binance.com made during SE-4's build
// (see binance-metrics.adapter.ts's header comment for the retention window confirmed the same
// way): openInterestHist rows carry an extra `CMCCirculatingSupply` field the mapper ignores.
describe('Binance open-interest payload mapping (architecture/chart-layouts.md §4.2, §4.3)', () => {
  it('maps an openInterestHist row using the venue timestamp, never Date.now()', () => {
    const row: BinanceOpenInterestHistRow & { CMCCirculatingSupply?: string } = {
      symbol: 'BTCUSDT',
      sumOpenInterest: '103212.79900000',
      sumOpenInterestValue: '7967553357.77484600',
      CMCCirculatingSupply: '20083028.00000000',
      timestamp: 1_789_247_400_000,
    };

    const observation = mapOpenInterestHistRow('binance:BTCUSDT', 'openInterest', row);

    expect(observation).toEqual({
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      time: 1_789_247_400_000,
      value: 103212.799,
      notional: 7967553357.774846,
    });
  });

  it('maps an openInterest snapshot, with no notional field', () => {
    const snapshot: BinanceOpenInterestSnapshot = {
      symbol: 'BTCUSDT',
      openInterest: '103361.768',
      time: 1_789_248_733_498,
    };

    const observation = mapOpenInterestSnapshot('binance:BTCUSDT', 'openInterest', snapshot);

    expect(observation).toEqual({
      metric: 'openInterest',
      instrument: 'binance:BTCUSDT',
      time: 1_789_248_733_498,
      value: 103361.768,
    });
    expect(observation.notional).toBeUndefined();
  });
});
