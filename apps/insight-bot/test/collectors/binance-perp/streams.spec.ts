import { combinedStreamUrl, MAX_STREAMS_PER_SOCKET } from '../../../src/collectors/binance-common/socket';
import { perpMarketWsBaseUrl, perpStreamNames } from '../../../src/collectors/binance-perp/streams';

/**
 * IB-006 — these two moved out of the socket spec when the socket became venue-agnostic:
 * `perpStreamNames` is the perp-shaped part (§4.1's two array streams), so it is specced
 * perp-side. The socket spec keeps `combinedStreamUrl`, which both collectors share.
 */
describe('perpStreamNames (WD-010: liquidations + one liveness stream)', () => {
  it('all-market liquidations, and ONE symbol\'s 1 s mark price for liveness — no klines, no all-market mark', () => {
    expect(perpStreamNames(['BTCUSDT', 'ETHUSDT'])).toEqual(['btcusdt@markPrice@1s', '!forceOrder@arr']);
  });

  it('the stream count no longer grows with the universe', () => {
    expect(perpStreamNames(Array.from({ length: 40 }, (_, i) => `SYM${i}USDT`))).toHaveLength(2);
    expect(2).toBeLessThan(MAX_STREAMS_PER_SOCKET);
  });

  it('refuses an empty universe rather than opening a socket with no liveness signal', () => {
    expect(() => perpStreamNames([])).toThrow(/no symbols/);
  });
});

/**
 * IB-BUG-012 — since 2026-04-23 the bare `fstream.binance.com/stream` carries `/public` streams
 * only; kline, markPrice and forceOrder are served under `/market`. The env var stays a host.
 */
describe('perpMarketWsBaseUrl (IB-BUG-012: the /market route)', () => {
  it('routes the default host to /market, so the socket URL is /market/stream?streams=…', () => {
    const base = perpMarketWsBaseUrl('wss://fstream.binance.com');
    expect(base).toBe('wss://fstream.binance.com/market');
    expect(combinedStreamUrl(base, perpStreamNames(['BTCUSDT']))).toBe(
      'wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s/!forceOrder@arr',
    );
  });

  it('a trailing slash or an already-routed base is accepted without doubling the route', () => {
    expect(perpMarketWsBaseUrl('wss://fstream.binance.com/')).toBe('wss://fstream.binance.com/market');
    expect(perpMarketWsBaseUrl('wss://fstream.binance.com/market')).toBe('wss://fstream.binance.com/market');
    expect(perpMarketWsBaseUrl('ws://127.0.0.1:9123')).toBe('ws://127.0.0.1:9123/market');
  });

  it('refuses any other path: the legacy /ws and /stream, and the routes that carry none of our streams', () => {
    for (const base of ['wss://fstream.binance.com/ws', 'wss://fstream.binance.com/stream', 'wss://fstream.binance.com/public', 'wss://fstream.binance.com/private']) {
      expect(() => perpMarketWsBaseUrl(base)).toThrow(/give the host only/);
    }
  });
});
