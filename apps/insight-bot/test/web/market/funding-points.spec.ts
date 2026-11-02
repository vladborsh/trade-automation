import { binanceFundingPoints, bybitFundingPoints, okxFundingPoints } from '../../../src/web/market/funding-points';

const H = 3_600_000;

describe('funding points (WD-008)', () => {
  it('Binance: fundingTime + fundingRate, inside [from, to], oldest first, seconds', () => {
    const rows = [
      { symbol: 'BTCUSDT', fundingTime: 16 * H, fundingRate: '0.0002' },
      { symbol: 'BTCUSDT', fundingTime: 8 * H, fundingRate: '0.0001' },
      { symbol: 'BTCUSDT', fundingTime: 0, fundingRate: '0.0003' }, // before the window
    ];
    expect(binanceFundingPoints(rows, H, 20 * H)).toEqual([
      { time: (8 * H) / 1000, rate: 0.0001 },
      { time: (16 * H) / 1000, rate: 0.0002 },
    ]);
  });

  it('Bybit: the timestamp arrives as a string', () => {
    expect(bybitFundingPoints([{ symbol: 'BTCUSDT', fundingRate: '-0.00005', fundingRateTimestamp: String(8 * H) }], 0, 9 * H))
      .toEqual([{ time: (8 * H) / 1000, rate: -0.00005 }]);
  });

  it('OKX: realizedRate wins; an empty realizedRate falls back to fundingRate (as the collector does)', () => {
    const rows = [
      { instId: 'BTC-USDT-SWAP', fundingRate: '0.0001', realizedRate: '0.00009', fundingTime: String(8 * H) },
      { instId: 'BTC-USDT-SWAP', fundingRate: '0.0002', realizedRate: '', fundingTime: String(16 * H) },
    ];
    expect(okxFundingPoints(rows, 0, 20 * H)).toEqual([
      { time: (8 * H) / 1000, rate: 0.00009 },
      { time: (16 * H) / 1000, rate: 0.0002 },
    ]);
  });

  it('a rate that is not a number throws — a venue gap must not draw as 0', () => {
    expect(() => binanceFundingPoints([{ symbol: 'X', fundingTime: H, fundingRate: '' }], 0, 2 * H)).toThrow(/not a number/);
  });

  it('one point per settlement time even when pages overlap', () => {
    const row = { symbol: 'BTCUSDT', fundingRate: '0.0001', fundingRateTimestamp: String(8 * H) };
    expect(bybitFundingPoints([row, row], 0, 9 * H)).toHaveLength(1);
  });
});
