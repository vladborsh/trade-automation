import { BinanceWeightTracker } from '../../../src/venues/binance/binance-weight.tracker';
import { PerpRest } from '../../../src/venues/binance/perp.rest';
import { BybitRest } from '../../../src/venues/bybit/bybit.rest';
import { OkxRest } from '../../../src/venues/okx/okx-rest';
import { TtlCache } from '../../../src/venues/ttl-cache';
import { FundingService } from '../../../src/web/market/funding.service';
import { FAKE_FAPI_USED_WEIGHT, fakeFetch, type FakeRoute } from '../../venues/fake-fetch';

const H = 3_600_000;
const NOW = 1_800_000_000_000;
const FROM = NOW - 24 * H;
const settle = (k: number) => FROM + k * 8 * H; // three settlements inside the window

const ROUTES = {
  binance: { match: '/fapi/v1/fundingRate?', answer: { body: [0, 1, 2].map((k) => ({ symbol: 'BTCUSDT', fundingTime: settle(k), fundingRate: '0.0001' })) } },
  premium: { match: '/fapi/v1/premiumIndex?symbol=BTCUSDT', answer: { body: { symbol: 'BTCUSDT', markPrice: '1', indexPrice: '1', lastFundingRate: '0.00012', nextFundingTime: NOW + H, time: NOW } } },
  bybit: { match: '/v5/market/funding/history', answer: { body: { retCode: 0, retMsg: 'OK', result: { list: [2, 1, 0].map((k) => ({ symbol: 'BTCUSDT', fundingRate: '0.0002', fundingRateTimestamp: String(settle(k)) })) } } } },
  okx: { match: '/api/v5/public/funding-rate-history', answer: [
    { body: { code: '0', data: [2, 1, 0].map((k) => ({ instId: 'BTC-USDT-SWAP', fundingRate: '0.0003', realizedRate: '0.0003', fundingTime: String(settle(k)) })) } },
    { body: { code: '0', data: [] } },
  ] },
} satisfies Record<string, FakeRoute>;

function setup(routes: FakeRoute[], spellings = { bybit: 'BTCUSDT', okx: 'BTC-USDT-SWAP' }) {
  const f = fakeFetch(routes);
  const weight = new BinanceWeightTracker();
  const service = new FundingService({
    perp: new PerpRest({ baseUrl: 'https://fapi.example', fetchImpl: f.impl, onWeight: (w) => weight.recordHeader(w, NOW) }),
    bybit: new BybitRest({ baseUrl: 'https://bybit.example', fetchImpl: f.impl }),
    okx: new OkxRest({ baseUrl: 'https://okx.example', fetchImpl: f.impl }),
    cache: new TtlCache({ now: () => NOW }),
    weight,
    spellings: () => spellings,
    now: () => NOW,
  });
  return { f, weight, service };
}

describe('FundingService (WD-008)', () => {
  it('settled series per venue, sorted by venue, plus Binance predicted as one point at now', async () => {
    const { service } = setup(Object.values(ROUTES));
    const res = await service.funding('BTCUSDT', FROM, NOW);
    expect(res.settled.map((s) => s.venue)).toEqual(['binance', 'bybit', 'okx']);
    for (const s of res.settled) expect(s.points).toHaveLength(3);
    expect(res.settled[2].points[0]).toEqual({ time: settle(0) / 1000, rate: 0.0003 });
    expect(res.predicted).toEqual([{ time: NOW / 1000, rate: 0.00012 }]);
    expect(res.unavailable).toEqual([]);
  });

  it('Binance weight: the documented 1 + 1 is counted, then the venue header (fresh) wins', async () => {
    const { weight, service } = setup(Object.values(ROUTES));
    expect(weight.used1m(NOW)).toBe(0);
    await service.funding('BTCUSDT', FROM, NOW);
    expect(weight.used1m(NOW)).toBe(Number(FAKE_FAPI_USED_WEIGHT));
  });

  it('a complete answer is cached for its TTL: no second round of venue calls', async () => {
    const { f, service } = setup(Object.values(ROUTES));
    await service.funding('BTCUSDT', FROM, NOW);
    const first = f.calls.length;
    await service.funding('BTCUSDT', FROM + 1_000, NOW - 1_000); // same hour-snapped window
    expect(f.calls.length).toBe(first);
  });

  it('one venue failing leaves its series out and names it — the others still answer', async () => {
    const { service } = setup([ROUTES.binance, ROUTES.premium, ROUTES.bybit, { match: '/api/v5/public/funding-rate-history', answer: { status: 503, body: 'down' } }]);
    const res = await service.funding('BTCUSDT', FROM, NOW);
    expect(res.settled.map((s) => s.venue)).toEqual(['binance', 'bybit']);
    expect(res.unavailable).toEqual(['okx']);
  });

  it('a partial answer is NOT cached: the next read asks the failed venue again', async () => {
    const { f, service } = setup([ROUTES.binance, ROUTES.premium, ROUTES.bybit, { match: '/api/v5/public/funding-rate-history', answer: { status: 503, body: 'down' } }]);
    await service.funding('BTCUSDT', FROM, NOW);
    await service.funding('BTCUSDT', FROM, NOW);
    expect(f.callsTo('funding-rate-history')).toHaveLength(2);
  });

  it('above the 1 800/min ceiling Binance is skipped and named; Bybit and OKX still answer', async () => {
    const { f, weight, service } = setup(Object.values(ROUTES));
    weight.recordHeader(1_900, NOW);
    const res = await service.funding('BTCUSDT', FROM, NOW);
    expect(f.callsTo('/fapi/')).toHaveLength(0);
    expect(res.unavailable).toEqual(['binance']);
    expect(res.predicted).toEqual([]);
    expect(res.settled.map((s) => s.venue)).toEqual(['bybit', 'okx']);
  });

  it('a venue the symbol is not listed on is skipped, not reported unavailable', async () => {
    const { f, service } = setup([ROUTES.binance, ROUTES.premium], {} as { bybit: string; okx: string });
    const res = await service.funding('BTCUSDT', FROM, NOW);
    expect(res.settled.map((s) => s.venue)).toEqual(['binance']);
    expect(res.unavailable).toEqual([]);
    expect(f.callsTo('bybit')).toHaveLength(0);
  });
});
