import * as fs from 'fs';
import * as path from 'path';
import { WebFlowsResponseSchema } from '@trade-automation/contracts';
import { FlowsService } from '../../src/web/market/flows.service';
import { TtlCache } from '../../src/venues/ttl-cache';
import type { CandlesService } from '../../src/web/market/candles.service';
import { fakeFetch, type FakeRoute } from '../venues/fake-fetch';

/** IB-091 — the flows endpoint over the captured answers (one probe of each source, 2026-11-04). */
const fx = (p: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', p), 'utf8'));
const cbBtc = fx('coinbase/candles-btc-usd-1m.json').rows as number[][];
const cbUsdt = fx('coinbase/candles-usdt-usd-1m.json').rows as number[][];
const bnSpot = (fx('binance/spot-btcusdt-1m-ib091.json').rows as Array<[number, string, string, string, string]>)
  .map((k) => ({ time: Math.floor(k[0] / 1000), open: 0, high: 0, low: 0, close: Number(k[4]), volume: 0 }));
const NOW = (cbBtc[0][0] + 30) * 1000; // half a minute after the newest captured minute

const routes = (over: Partial<Record<'usdt', FakeRoute['answer']>> = {}): FakeRoute[] => [
  { match: 'get_volatility_index_data', answer: { body: fx('deribit/dvol-btc-1h.json') } },
  { match: 'open-interest-volume-ratio', answer: { body: fx('okx/rubik-option-oi-volume-ratio-btc.json') } },
  { match: 'stablecoincharts/all', answer: { body: fx('defillama/stablecoincharts-all.json').rows } },
  { match: /products\/USDT-USD\/candles\?granularity=60$/, answer: over.usdt ?? { body: cbUsdt } },
  { match: /products\/BTC-USD\/candles\?granularity=60$/, answer: { body: cbBtc } },
  { match: 'granularity=3600', answer: { body: [] } }, // no hourly history in this spec: rarity refuses, the value stands
];
const markets: string[] = [];
const candles = { candles: async (m: string, _s: string, tf: string) => { markets.push(m); return tf === '1m' ? bnSpot : []; } } as unknown as CandlesService;
const service = (f: ReturnType<typeof fakeFetch>) => new FlowsService({ cache: new TtlCache(), candles, fetchImpl: f.impl, now: () => NOW });

describe('FlowsService (IB-091)', () => {
  it('answers the contract from the real shapes; the premium is D18 (≈ −0.01 %), not the raw −0.16 %', async () => {
    const r = WebFlowsResponseSchema.parse(await service(fakeFetch(routes())).flows('24h'));
    expect(r.dvol.value).toBe(39.74);
    expect(r.putCall).toMatchObject({ oiRatio: 0.9924, volumeRatio: 1.7916, unavailable: null });
    expect(r.stablecoins.supplyUsd).toBeCloseTo(296_228_298_548.12, 2); // in coins, not coins × price
    expect(r.coinbasePremium.minutes).toBe(60);
    expect(Math.abs(r.coinbasePremium.premiumPct?.value ?? 1)).toBeLessThan(0.05);
    expect(r.coinbasePremium.premiumPct?.rarity).toBeNull(); // no 20 days of hourly history here (D3)
  });

  it('D18, NO RAW FALLBACK: without USDT-USD the premium tile is source_unavailable, with no figure', async () => {
    const r = await service(fakeFetch(routes({ usdt: { status: 503, body: { message: 'down' } } }))).flows('24h');
    expect(r.coinbasePremium).toMatchObject({ premiumPct: null, minutes: 0, unavailable: 'source_unavailable' });
    expect(r.coinbasePremium.series).toEqual([]);
    expect(r.dvol.unavailable).toBeNull(); // one source down does not take the others with it
  });

  it('cached box-wide: a second poll inside the minute costs the sources nothing', async () => {
    const f = fakeFetch(routes());
    const s = service(f);
    await s.flows('24h');
    const n = f.calls.length;
    await s.flows('24h');
    await s.flows('1h'); // another period re-uses every source read
    expect(f.calls.length).toBe(n);
    expect(f.callsTo('granularity=3600').length).toBe(4); // 2 pages × BTC-USD and USDT-USD = 25 days (D3)
  });

  it('Binance is read as SPOT only: the flows path adds nothing to the fapi weight', async () => {
    markets.length = 0;
    await service(fakeFetch(routes())).flows('24h');
    expect(markets.length).toBeGreaterThan(0);
    expect(new Set(markets)).toEqual(new Set(['spot']));
  });
});
