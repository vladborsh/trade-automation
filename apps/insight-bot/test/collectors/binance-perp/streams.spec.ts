import { MAX_STREAMS_PER_SOCKET } from '../../../src/collectors/binance-common/socket';
import { perpStreamNames } from '../../../src/collectors/binance-perp/streams';

/**
 * IB-006 — these two moved out of the socket spec when the socket became venue-agnostic:
 * `perpStreamNames` is the perp-shaped part (§4.1's two array streams), so it is specced
 * perp-side. The socket spec keeps `combinedStreamUrl`, which both collectors share.
 */
describe('perpStreamNames (§4.1)', () => {
  it('one socket carries a kline per symbol plus the two array streams, lower-cased', () => {
    expect(perpStreamNames(['BTCUSDT', 'ETHUSDT'])).toEqual([
      'btcusdt@kline_1m', 'ethusdt@kline_1m', '!markPrice@arr@1s', '!forceOrder@arr',
    ]);
  });

  it('a 30-symbol universe fits comfortably', () => {
    expect(perpStreamNames(Array.from({ length: 30 }, (_, i) => `SYM${i}USDT`))).toHaveLength(32);
    expect(perpStreamNames(Array.from({ length: 30 }, (_, i) => `SYM${i}USDT`)).length).toBeLessThan(MAX_STREAMS_PER_SOCKET);
  });
});
