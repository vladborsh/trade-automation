import { readFileSync } from 'fs';
import { join } from 'path';
import { WebMarketCardsResponseSchema } from '@trade-automation/contracts';
import type { FetchLike } from '../../src/venues/binance/rest.base';
import { liveDominance, liveMarketCards } from '../../src/web/market/live-market-cards';
import { CoinMarketRowSchema, FngPayloadSchema, GlobalPayloadSchema } from '../../src/web/market/market-cards.payloads';
import { COINGECKO_TTL_MS, MarketCardsService } from '../../src/web/market/market-cards.service';

/**
 * The market cards read live (2026-10-24). The fixtures are real venue answers, so a renamed
 * field fails here (AGENTS.md: shapes are pinned by fixtures).
 */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'context', name), 'utf8'));

const FNG = fixture('fng.json');
const GLOBAL = fixture('global.json');
const MARKETS = fixture('coins-markets.json');
const COINS = ['bitcoin', 'ethereum', 'solana'];
const NOW = Date.UTC(2026, 9, 24, 12);

function fakeFetch(fail: Set<string> = new Set()) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const key = url.includes('/fng/') ? 'fng' : url.includes('/global') ? 'global' : 'markets';
    const body = { fng: FNG, global: GLOBAL, markets: MARKETS }[key];
    const ok = !fail.has(key);
    return { ok, status: ok ? 200 : 429, statusText: ok ? 'OK' : 'Too Many Requests', headers: { get: () => null }, json: async () => body };
  };
  return { impl, calls };
}

describe('live market cards: venue shapes', () => {
  it('the committed fixtures parse', () => {
    expect(() => FngPayloadSchema.parse(FNG)).not.toThrow();
    expect(() => GlobalPayloadSchema.parse(GLOBAL)).not.toThrow();
    expect(CoinMarketRowSchema.array().parse(MARKETS).map((r) => r.id)).toEqual(COINS);
  });
});

describe('liveMarketCards', () => {
  const markets = CoinMarketRowSchema.array().parse(MARKETS);
  const global = GlobalPayloadSchema.parse(GLOBAL);

  it('builds every card, valid against the contract, and says it is live', () => {
    const out = liveMarketCards({ fearGreed: [{ day: '2026-10-24', value: 40, classification: 'Fear' }], global, markets, coins: COINS, nowMs: NOW });
    expect(WebMarketCardsResponseSchema.parse(out)).toEqual(out);
    expect(out.live).toBe(true);
    expect(out.fearGreed?.now.value).toBe(40);
    expect(out.dominance?.btcPct).toBe(global.data.market_cap_percentage.btc);
    expect(out.btcVsTop?.coinsCounted).toBe(3);
    expect(out.capsDay).toBe('2026-10-24');
  });

  it('caps are largest first, shares sum to one, the 24 h change is the venue\'s, as a FRACTION', () => {
    const out = liveMarketCards({ fearGreed: null, global: null, markets, coins: COINS, nowMs: NOW });
    expect(out.caps.map((c) => c.coin)).toEqual(['bitcoin', 'ethereum', 'solana']);
    expect(out.caps.reduce((a, c) => a + (c.share ?? 0), 0)).toBeCloseTo(1, 10);
    const btc = markets.find((m) => m.id === 'bitcoin')!;
    expect(out.caps[0].change24h).toBeCloseTo((btc.market_cap_change_percentage_24h as number) / 100, 12);
    expect(out.caps[0].change7d).toBeNull(); // history is paid: unknown, not zero
  });

  it('ignores a coin the venue sent that is not in our top list', () => {
    const out = liveMarketCards({ fearGreed: null, global: null, markets, coins: ['bitcoin'], nowMs: NOW });
    expect(out.caps.map((c) => c.coin)).toEqual(['bitcoin']);
  });

  it('a failed source is a null card, not a failed page', () => {
    const out = liveMarketCards({ fearGreed: null, global: null, markets: null, coins: COINS, nowMs: NOW });
    expect(out).toMatchObject({ fearGreed: null, dominance: null, btcVsTop: null, caps: [], capsDay: null, live: true });
  });

  it('dominance moves are null, never zero; the total\'s 24 h move is the venue\'s percentage', () => {
    const dom = liveDominance(global, NOW)!;
    expect(dom.changePct24h).toBeNull();
    expect(dom.changePct7d).toBeNull();
    expect(dom.totalChangePct24h).toBe(global.data.market_cap_change_percentage_24h_usd);
    expect(dom.atMs).toBe((global.data.updated_at as number) * 1000);
  });

  it('no BTC share from the venue is no card, not 0 %', () => {
    expect(liveDominance({ data: { total_market_cap: { usd: 1 }, market_cap_percentage: { eth: 10 } } }, NOW)).toBeNull();
  });
});

describe('MarketCardsService', () => {
  it('reads each source once per cache window however many pages ask', async () => {
    let now = NOW;
    const { impl, calls } = fakeFetch();
    const service = new MarketCardsService({ fngBaseUrl: 'https://f', coingeckoBaseUrl: 'https://cg', fetchImpl: impl, now: () => now });
    await Promise.all([service.cards(COINS), service.cards(COINS)]);
    expect(calls).toHaveLength(3);
    now += COINGECKO_TTL_MS - 1;
    await service.cards(COINS);
    expect(calls).toHaveLength(3);
    now += 2;
    await service.cards(COINS);
    expect(calls.filter((u) => u.includes('coingecko') || u.startsWith('https://cg'))).toHaveLength(4); // global + markets again
    expect(calls.filter((u) => u.includes('/fng/'))).toHaveLength(1); // its own, longer window
  });

  it('asks alternative.me for eight days and CoinGecko for exactly our coins', async () => {
    const { impl, calls } = fakeFetch();
    await new MarketCardsService({ fngBaseUrl: 'https://f/', coingeckoBaseUrl: 'https://cg/', fetchImpl: impl, now: () => NOW }).cards(COINS);
    expect(calls).toContain('https://f/fng/?limit=8');
    expect(calls).toContain('https://cg/api/v3/global');
    expect(calls.find((u) => u.includes('/coins/markets'))).toBe(
      'https://cg/api/v3/coins/markets?vs_currency=usd&ids=bitcoin%2Cethereum%2Csolana&per_page=3',
    );
  });

  it('a refused read serves the last good answer; with none, only that card is empty', async () => {
    let now = NOW;
    const fail = new Set<string>();
    const { impl } = fakeFetch(fail);
    const service = new MarketCardsService({ fngBaseUrl: 'https://f', coingeckoBaseUrl: 'https://cg', fetchImpl: impl, now: () => now });
    const first = await service.cards(COINS);
    fail.add('global');
    now += COINGECKO_TTL_MS + 1;
    expect((await service.cards(COINS)).dominance).toEqual(first.dominance);

    const fresh = new MarketCardsService({ fngBaseUrl: 'https://f', coingeckoBaseUrl: 'https://cg', fetchImpl: impl, now: () => now });
    const out = await fresh.cards(COINS);
    expect(out.dominance).toBeNull();
    expect(out.fearGreed).not.toBeNull();
    expect(out.caps.length).toBe(3);
  });
});
