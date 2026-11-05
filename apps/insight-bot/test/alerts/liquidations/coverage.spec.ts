import { STALE_AFTER_MS } from '../../../src/collectors/uptime/uptime.recorder';
import { silentVenues, type VenueStatus } from '../../../src/alerts/liquidations/coverage';

/** IB-122 (L3, L5) — a venue that could not report the coin in the window is named, with why. */
const AT = Date.UTC(2026, 10, 5, 12, 0, 0);
const START = AT - 300_000;
const TRX = { binance: 'TRXUSDT', bybit: 'TRXUSDT', okx: 'TRX-USDT-SWAP' };
const alive = { firstSeen: AT - 86_400_000, lastSeen: AT };

function status(over: Partial<VenueStatus> = {}): VenueStatus {
  return {
    heartbeats: new Map([['binance', alive], ['bybit', alive], ['okx', alive]]),
    gaps: [],
    tracked: new Map([['bybit', new Map([['TRXUSDT', AT - 3_600_000]])], ['okx', new Map([['TRX-USDT-SWAP', AT - 3_600_000]])]]),
    ...over,
  };
}

describe('silentVenues (L3, L5)', () => {
  it('all three live and collecting: none named', () => {
    expect(silentVenues(TRX, START, AT, status())).toEqual([]);
  });

  it('TRX before L5: Bybit and OKX did not track it — named not_collected, never $0', () => {
    expect(silentVenues(TRX, START, AT, status({ tracked: new Map() }))).toEqual([
      { venue: 'bybit', reason: 'not_collected' }, { venue: 'okx', reason: 'not_collected' },
    ]);
  });

  it('a coin tracked for less than 5 min is not collected yet; exactly 5 min is', () => {
    const tracked = (since: number): VenueStatus['tracked'] => new Map([['bybit', new Map([['TRXUSDT', since]])], ['okx', new Map([['TRX-USDT-SWAP', AT - 3_600_000]])]]);
    expect(silentVenues(TRX, START, AT, status({ tracked: tracked(AT - 299_999) }))).toEqual([{ venue: 'bybit', reason: 'not_collected' }]);
    expect(silentVenues(TRX, START, AT, status({ tracked: tracked(AT - 300_000) }))).toEqual([]);
  });

  it('a stale heartbeat, a gap overlapping the window, or no heartbeat at all: stream_silent', () => {
    const stale = new Map([['binance', alive], ['bybit', alive], ['okx', { firstSeen: alive.firstSeen, lastSeen: AT - STALE_AFTER_MS - 1 }]]) as VenueStatus['heartbeats'];
    expect(silentVenues(TRX, START, AT, status({ heartbeats: stale }))).toEqual([{ venue: 'okx', reason: 'stream_silent' }]);
    expect(silentVenues(TRX, START, AT, status({ gaps: [{ venue: 'binance', from: START - 60_000, to: START + 1 }] }))).toEqual([{ venue: 'binance', reason: 'stream_silent' }]);
    expect(silentVenues(TRX, START, AT, status({ gaps: [{ venue: 'binance', from: START - 60_000, to: START }] }))).toEqual([]); // ended as the window began
    expect(silentVenues(TRX, START, AT, status({ heartbeats: new Map() })).map((s) => s.reason)).toEqual(['stream_silent', 'stream_silent', 'stream_silent']);
  });

  it('a venue the mapper has no contract for: not_listed', () => {
    expect(silentVenues({ ...TRX, okx: null }, START, AT, status())).toEqual([{ venue: 'okx', reason: 'not_listed' }]);
  });
});
