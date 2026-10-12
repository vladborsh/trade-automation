import { presentNote, venueNote } from './venue-note';

describe('the §12.4 honesty line', () => {
  it('names the venues that are missing', () => {
    expect(venueNote({ present: ['bybit', 'okx'], missing: ['binance'] }))
      .toEqual({ key: 'liq.venues.missing', params: { venues: 'binance' } });
  });

  it('is ABSENT when nothing is missing, rather than a banner people learn to ignore', () => {
    expect(venueNote({ present: ['binance', 'bybit', 'okx'], missing: [] })).toBeNull();
  });

  it('always states which venues the numbers DID come from', () => {
    // Silence would let Bybit + OKX read as the whole market, which is the thing §12.4 forbids.
    expect(presentNote({ present: ['bybit', 'okx'], missing: ['binance'] }))
      .toEqual({ key: 'liq.venues.present', params: { venues: 'bybit, okx' } });
  });

  it('says nothing about sources when there are none', () => {
    expect(presentNote({ present: [], missing: ['binance', 'bybit', 'okx'] })).toBeNull();
  });
});
