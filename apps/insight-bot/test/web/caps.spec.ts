import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';
import { WEB_CAPS_TOP_N, WebCapsResponseSchema, type WebCapsResponse } from '@trade-automation/contracts';
import type { FetchLike } from '../../src/venues/binance/rest.base';
import { TtlCache } from '../../src/venues/ttl-cache';
import { assembleCaps, type CapsInput } from '../../src/web/market/caps';
import { CapsService, STABLECOINS_TTL_MS } from '../../src/web/market/caps.service';
import { WebMarketController } from '../../src/web/market/market.controller';
import { COINGECKO_TTL_MS } from '../../src/web/market/market-cards.service';
import {
  CapsMarketRowSchema, GlobalPayloadSchema, StablecoinRowSchema, type CapsMarketRow, type GlobalPayload, type StablecoinRow,
} from '../../src/web/market/market-cards.payloads';

/**
 * IB-087 — the caps block (market-page design D11). The two `/coins/markets` fixtures are real
 * CoinGecko answers captured 2026-11-03 (trimmed to 40 and 60 rows), so a renamed field fails here.
 */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'context', name), 'utf8'));
const TOP: CapsMarketRow[] = CapsMarketRowSchema.array().parse(fixture('coins-markets-top.json'));
const STABLES: StablecoinRow[] = StablecoinRowSchema.array().parse(fixture('coins-markets-stablecoins.json'));
const NOW = Date.UTC(2026, 10, 3, 14);

/** A `/global` whose total is consistent with today's fixture caps (the committed global.json is from 2026-09-28). */
function globalOf(over: Partial<GlobalPayload['data']> = {}): GlobalPayload {
  return {
    data: {
      total_market_cap: { usd: 3.0e12 },
      market_cap_percentage: { btc: 51.7, eth: 9.3 },
      market_cap_change_percentage_24h_usd: -1.1,
      updated_at: Math.floor(NOW / 1000) - 30,
      ...over,
    },
  };
}
const input = (over: Partial<CapsInput> = {}): CapsInput =>
  ({ period: '24h', top: TOP, stablecoins: STABLES, global: globalOf(), nowMs: NOW, ...over });
/** Every answer the server builds must satisfy the contract, refusals included. */
const build = (over: Partial<CapsInput> = {}): WebCapsResponse => WebCapsResponseSchema.parse(assembleCaps(input(over)));

describe('fixtures (shape pins)', () => {
  it('the captured payloads parse and carry the fields the block reads', () => {
    expect(TOP).toHaveLength(40);
    expect(TOP[0]).toMatchObject({ id: 'bitcoin', symbol: 'btc' });
    for (const r of TOP.slice(0, WEB_CAPS_TOP_N)) {
      expect(typeof r.price_change_percentage_1h_in_currency).toBe('number');
      expect(typeof r.price_change_percentage_24h_in_currency).toBe('number');
      expect(typeof r.price_change_percentage_7d_in_currency).toBe('number');
    }
    expect(STABLES.map((s) => s.id)).toEqual(expect.arrayContaining(['tether', 'usd-coin']));
    expect(GlobalPayloadSchema.parse(fixture('global.json')).data.market_cap_percentage.btc).toBeGreaterThan(1);
  });
});

describe('assembleCaps — coins', () => {
  it('the top 30 by cap, largest first, tickers upper-case, stablecoins flagged', () => {
    const r = build();
    expect(r.coins).toHaveLength(WEB_CAPS_TOP_N);
    expect(r.coins.map((c) => c.capUsd)).toEqual([...r.coins.map((c) => c.capUsd)].sort((a, b) => b - a));
    expect(r.coins[0]).toMatchObject({ id: 'bitcoin', symbol: 'BTC', stable: false });
    expect(r.coins.find((c) => c.id === 'tether')?.stable).toBe(true);
    expect(r.coinsUnavailable).toBeNull();
  });

  it.each([
    ['1h', 'price_change_percentage_1h_in_currency'],
    ['24h', 'price_change_percentage_24h_in_currency'],
    ['7d', 'price_change_percentage_7d_in_currency'],
  ] as const)('%s reads %s', (period, field) => {
    const r = build({ period });
    const btc = TOP.find((t) => t.id === 'bitcoin')!;
    expect(r.coins[0].changePct).toBe(btc[field]);
    expect(r.changeUnavailable).toBeNull();
  });

  it('the three periods really are different numbers (a mapping mix-up would pass the test above otherwise)', () => {
    const [h1, d1, w1] = (['1h', '24h', '7d'] as const).map((period) => build({ period }).coins[0].changePct);
    expect(new Set([h1, d1, w1]).size).toBe(3);
  });

  it('4h is refused explicitly — CoinGecko serves no 4h change, and none is invented', () => {
    const r = build({ period: '4h' });
    expect(r.changeUnavailable).toBe('period_not_served');
    expect(r.coins).toHaveLength(WEB_CAPS_TOP_N);
    expect(r.coins.every((c) => c.changePct === null)).toBe(true);
  });

  it('a coin with no cap is left out, not drawn as a zero-area tile', () => {
    const top = TOP.map((t, i) => (i === 3 ? { ...t, market_cap: null } : t));
    expect(build({ top }).coins.map((c) => c.id)).not.toContain(TOP[3].id);
  });

  it('a failed top read is an explicit refusal, never an empty list without a reason', () => {
    const r = build({ top: null });
    expect(r.coins).toEqual([]);
    expect(r.coinsUnavailable).toBe('source_unavailable');
    expect(r.dominanceUnavailable).toBe('source_unavailable');
  });
});

describe('assembleCaps — dominance bar', () => {
  it('BTC and ETH are /global\'s, stablecoins are summed, the rest is the remainder: 100 in total', () => {
    const d = build().dominance!;
    expect(d.btcPct).toBe(51.7);
    expect(d.ethPct).toBe(9.3);
    const expectedStablesUsd = STABLES.reduce((sum, s) => {
      const live = TOP.find((t) => t.id === s.id)?.market_cap;
      return sum + ((live ?? s.market_cap) ?? 0);
    }, 0);
    expect(d.stablesPct).toBeCloseTo((expectedStablesUsd / 3.0e12) * 100, 9);
    expect(d.btcPct + d.ethPct + d.stablesPct + d.restPct).toBeCloseTo(100, 9);
    expect(d.stablesCounted).toBe(STABLES.filter((s) => (TOP.find((t) => t.id === s.id)?.market_cap ?? s.market_cap ?? 0) > 0).length);
    expect(d.asOf).toBe(new Date((Math.floor(NOW / 1000) - 30) * 1000).toISOString());
  });

  it('a stablecoin in the top read uses the LIVE cap, not the day-old category cap', () => {
    const stablecoins = STABLES.map((s) => (s.id === 'tether' ? { ...s, market_cap: 1 } : s));
    const live = build({ stablecoins }).dominance!.stablesPct;
    expect(live).toBeCloseTo(build().dominance!.stablesPct, 9);
  });

  it('a stablecoin outside the top read is counted from the category (the tail)', () => {
    const tail = STABLES.find((s) => !TOP.some((t) => t.id === s.id) && (s.market_cap ?? 0) > 0)!;
    const without = build({ stablecoins: STABLES.filter((s) => s.id !== tail.id) }).dominance!;
    const withIt = build().dominance!;
    expect(withIt.stablesPct - without.stablesPct).toBeCloseTo((tail.market_cap! / 3.0e12) * 100, 9);
  });

  it('refuses when /global answers in fractions instead of percent (a unit change would draw BTC at 0.5 %)', () => {
    const r = build({ global: globalOf({ market_cap_percentage: { btc: 0.517, eth: 0.093 } }) });
    expect(r.dominance).toBeNull();
    expect(r.dominanceUnavailable).toBe('sources_disagree');
  });

  it('refuses when the parts exceed 100 % (a negative remainder)', () => {
    const r = build({ global: globalOf({ total_market_cap: { usd: 3.0e11 } }) });
    expect(r.dominanceUnavailable).toBe('sources_disagree');
  });

  it.each([
    ['global', { global: null }],
    ['stablecoin category', { stablecoins: null }],
  ] as const)('a failed %s read refuses the bar but keeps the coins', (_name, over) => {
    const r = build(over);
    expect(r.dominance).toBeNull();
    expect(r.dominanceUnavailable).toBe('source_unavailable');
    expect(r.coins).toHaveLength(WEB_CAPS_TOP_N);
  });

  it('carries the CoinGecko attribution', () => {
    expect(build().source).toEqual({ name: 'CoinGecko', url: 'https://www.coingecko.com' });
  });
});

describe('CapsService — CoinGecko calls per minute', () => {
  function setup(fail = new Set<string>()) {
    let now = NOW;
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      const body = url.includes('category=stablecoins') ? fixture('coins-markets-stablecoins.json') : fixture('coins-markets-top.json');
      const failed = [...fail].some((f) => url.includes(f));
      return { ok: !failed, status: failed ? 429 : 200, statusText: failed ? 'Too Many Requests' : 'OK', json: async () => body } as never;
    };
    const global = jest.fn(async () => globalOf());
    const service = new CapsService({
      coingeckoBaseUrl: 'https://cg.test', cache: new TtlCache({ now: () => now }), cards: { global }, fetchImpl, now: () => now,
    });
    return { service, calls, global, advance: (ms: number) => { now += ms; } };
  }

  it('one top read per 120 s and one stablecoin read per day, whatever the period or number of polls', async () => {
    const { service, calls, global, advance } = setup();
    for (const period of ['1h', '4h', '24h', '7d', '24h'] as const) WebCapsResponseSchema.parse(await service.caps(period));
    expect(calls.filter((u) => u.includes('order=market_cap_desc&per_page=250&page=1&price_change')).length).toBe(1);
    expect(calls.filter((u) => u.includes('category=stablecoins')).length).toBe(1);
    expect(global).toHaveBeenCalledTimes(5); // the cards' own 120 s cache decides; not a call each

    advance(COINGECKO_TTL_MS);
    await service.caps('24h');
    expect(calls.filter((u) => u.includes('price_change')).length).toBe(2);
    expect(calls.filter((u) => u.includes('category=stablecoins')).length).toBe(1);

    advance(STABLECOINS_TTL_MS);
    await service.caps('24h');
    expect(calls.filter((u) => u.includes('category=stablecoins')).length).toBe(2);
  });

  it('a 429 is a refusal now and a retry on the next poll (failures are not cached)', async () => {
    const fail = new Set(['price_change']);
    const { service, calls } = setup(fail);
    const first = await service.caps('24h');
    expect(first.coinsUnavailable).toBe('source_unavailable');
    fail.clear();
    const second = await service.caps('24h');
    expect(second.coinsUnavailable).toBeNull();
    expect(calls.filter((u) => u.includes('price_change')).length).toBe(2);
  });
});

describe('WebMarketController', () => {
  it('rejects an unknown period with 400 and defaults to 24h', async () => {
    const caps = jest.fn(async (period: string) => ({ period }) as never);
    const controller = new WebMarketController({ caps } as never);
    await expect(controller.caps('30d')).rejects.toMatchObject({ status: 400 });
    await controller.caps();
    expect(caps).toHaveBeenCalledWith('24h');
  });

  it('503 when the service is not configured', async () => {
    await expect(new WebMarketController().caps('24h')).rejects.toBeInstanceOf(HttpException);
  });
});
