import { SpotRest, SPOT_REST_PAGE_LIMIT } from '../../../src/venues/binance/spot.rest';

/** A `FetchLike` that records the URLs it is asked for and answers with `rows`. */
function fakeFetch(rows: unknown = [], headers: Record<string, string> = {}) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      json: async () => rows,
    };
  };
  return { urls, impl };
}

describe('SpotRest (§4.2) — spot paths and spot weight', () => {
  it('klines is /api/v3/klines on the spot base, never /fapi', async () => {
    const f = fakeFetch([]);
    await new SpotRest({ baseUrl: 'https://api.binance.com', fetchImpl: f.impl }).klines('BTCUSDT');
    expect(f.urls).toEqual(['https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2']);
  });

  it('klineRange asks for one page of the window, capped at spot’s 1000 rows', async () => {
    const f = fakeFetch([]);
    await new SpotRest({ baseUrl: 'https://api.binance.com', fetchImpl: f.impl }).klineRange('ETHUSDT', 1_000, 2_000);
    expect(f.urls[0]).toBe(`https://api.binance.com/api/v3/klines?symbol=ETHUSDT&interval=1m&startTime=1000&endTime=2000&limit=${SPOT_REST_PAGE_LIMIT}`);
    expect(SPOT_REST_PAGE_LIMIT).toBe(1000); // USD-M allows 1500; spot does not
  });

  it('reports the venue’s used weight, which the caller sends to the SPOT gauge only', async () => {
    const f = fakeFetch([], { 'x-mbx-used-weight-1m': '17' });
    const seen: number[] = [];
    await new SpotRest({ baseUrl: 'https://api.binance.com', fetchImpl: f.impl, onWeight: (w) => seen.push(w) }).klines('BTCUSDT');
    expect(seen).toEqual([17]);
  });

  it('a non-2xx answer throws with the status, so a repair failure is visible', async () => {
    const impl = async () => ({ ok: false, status: 418, statusText: 'Teapot', headers: { get: () => null }, json: async () => ({}) });
    await expect(new SpotRest({ baseUrl: 'https://api.binance.com', fetchImpl: impl }).klines('BTCUSDT')).rejects.toThrow(/418/);
  });
});
