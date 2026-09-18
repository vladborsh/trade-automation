import { memberDisplayName, venueDisplayName } from './venue-names';

describe('venue display names (architecture/aggregate-oi.md §1)', () => {
  it('maps every aggregate venue to its display name', () => {
    expect(venueDisplayName('binance')).toBe('Binance');
    expect(venueDisplayName('bybit')).toBe('Bybit');
    expect(venueDisplayName('hyperliquid')).toBe('Hyperliquid');
  });

  it('falls back to the raw venue for an unknown one', () => {
    expect(venueDisplayName('okx')).toBe('okx');
  });

  it('names a member by the venue prefix of its id', () => {
    expect(memberDisplayName('binance:BTCUSDT')).toBe('Binance');
    expect(memberDisplayName('bybit:BTCUSDT')).toBe('Bybit');
    expect(memberDisplayName('hyperliquid:BTC')).toBe('Hyperliquid');
  });
});
