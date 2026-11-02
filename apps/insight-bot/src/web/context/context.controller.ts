import { Controller, Get, HttpException, Optional } from '@nestjs/common';
import type { WebMarketCardsResponse } from '@trade-automation/contracts';
import { AppConfigService } from '../../config/config.service';
import { MarketCardsService } from '../market/market-cards.service';

/**
 * IB-037 (design §2, §4, §10) — the market page's cards: Fear & Greed, BTC dominance, BTC against
 * the top 20 and the top-20 caps. Behind IB-029's module-wide `APP_GUARD`, so no decorator here.
 *
 * **WD-009: live only.** The cards come from alternative.me and CoinGecko through
 * `MarketCardsService` (cached; its header has the request rate). The database fallback, and the
 * `fear-greed` and `market-cap` history routes that read stored context tables, are gone: nothing in
 * the dashboard called them, and CoinGecko's market-cap HISTORY is a paid endpoint (`/global` is
 * free but answers "now" only). Per the WD-009 default the page keeps the current snapshot and
 * drops the historical parts; a paid key would be an owner's decision (none in env.schema).
 */
@Controller('api/web/context')
export class WebContextController {
  constructor(
    private readonly config: AppConfigService,
    @Optional() private readonly live?: MarketCardsService,
  ) {}

  /** `GET …/context/cards` — everything the market page's cards show, in one payload. */
  @Get('cards')
  async cards(): Promise<WebMarketCardsResponse> {
    if (!this.live) throw new HttpException({ code: 'VENUE_UNAVAILABLE', message: 'market cards not configured' }, 503);
    return this.live.cards(this.topCoins());
  }

  /**
   * The top 20 of the universe's 30-day volume rank, mapped to CoinGecko ids (§10).
   * Symbols without a `coingecko_id` are skipped rather than guessed: an id we invented would
   * silently read another coin's cap.
   */
  private topCoins(): string[] {
    return [...this.config.symbols]
      .filter((symbol) => symbol.coingecko_id)
      .sort((a, b) => (a.volume_rank ?? Number.MAX_SAFE_INTEGER) - (b.volume_rank ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 20)
      .map((symbol) => symbol.coingecko_id as string);
  }
}
