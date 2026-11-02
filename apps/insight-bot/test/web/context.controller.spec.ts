import { HttpException } from '@nestjs/common';
import type { WebMarketCardsResponse } from '@trade-automation/contracts';
import type { AppConfigService } from '../../src/config/config.service';
import { WebContextController } from '../../src/web/context/context.controller';
import type { MarketCardsService } from '../../src/web/market/market-cards.service';

/**
 * IB-037 / WD-009 — the market cards, now LIVE only (`MarketCardsService`, its own spec covers the
 * venue reads). What is pinned here is the controller's half: which coins it asks for, and that it
 * never falls back to stored tables. The `fear-greed` and `market-cap` history routes are gone.
 */
const config = (symbols: Array<{ id: string; coingecko_id?: string; volume_rank?: number }>) =>
  ({ symbols }) as unknown as AppConfigService;

const UNIVERSE = [
  { id: 'ETHUSDT', coingecko_id: 'ethereum', volume_rank: 2 },
  { id: 'BTCUSDT', coingecko_id: 'bitcoin', volume_rank: 1 },
  { id: 'NOIDUSDT', volume_rank: 3 }, // no coingecko_id: must be skipped, never guessed
];

const CARDS: WebMarketCardsResponse = {
  fearGreed: null, dominance: null, btcVsTop: null, caps: [], capsDay: null, capsSource: 'coingecko', live: true,
};

function fakeLive() {
  const asked: string[][] = [];
  const live = { cards: async (coins: readonly string[]) => { asked.push([...coins]); return CARDS; } } as unknown as MarketCardsService;
  return { live, asked };
}

describe('WebContextController — cards (WD-009: live only)', () => {
  it('asks the live service for the universe top by volume rank, skipping coins with no CoinGecko id', async () => {
    const { live, asked } = fakeLive();
    await expect(new WebContextController(config(UNIVERSE), live).cards()).resolves.toBe(CARDS);
    expect(asked).toEqual([['bitcoin', 'ethereum']]);
  });

  it('takes at most 20 coins', async () => {
    const { live, asked } = fakeLive();
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `C${i}USDT`, coingecko_id: `coin-${i}`, volume_rank: i + 1 }));
    await new WebContextController(config(many), live).cards();
    expect(asked[0]).toHaveLength(20);
    expect(asked[0][0]).toBe('coin-0');
  });

  it('without the live service it answers 503 — there is no stored fallback any more', async () => {
    const error = await new WebContextController(config(UNIVERSE)).cards().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
  });

  it('the history routes are gone (no stored context tables are read by the web layer)', () => {
    const proto = WebContextController.prototype as unknown as Record<string, unknown>;
    expect(proto.fearGreed).toBeUndefined();
    expect(proto.marketCap).toBeUndefined();
  });
});
