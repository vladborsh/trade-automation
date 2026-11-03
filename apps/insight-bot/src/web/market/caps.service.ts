import type { WebCapsResponse, WebMarketPeriod } from '@trade-automation/contracts';
import type { FetchLike } from '../../venues/binance/rest.base';
import type { TtlCache } from '../../venues/ttl-cache';
import { assembleCaps } from './caps';
import { COINGECKO_TTL_MS, type MarketCardsService } from './market-cards.service';
import {
  CapsMarketRowSchema, StablecoinRowSchema, type CapsMarketRow, type StablecoinRow,
} from './market-cards.payloads';

/**
 * IB-087 — the caps block, live from CoinGecko, nothing stored (D7).
 *
 * **CoinGecko requests per minute, however many pages poll** (each read is cached box-wide):
 *
 * | read | cache | at most |
 * |---|---|---|
 * | `/coins/markets` top 250 by cap, with 1h/24h/7d change | 120 s | 0.5/min |
 * | `/coins/markets?category=stablecoins` (ids + caps) | 24 h | ≈ 0 |
 * | `/global` | shared with the market cards (`MarketCardsService.global()`) | +0 |
 *
 * So the caps block adds **≤ 0.5 CoinGecko calls a minute**; with the market cards (≤ 1/min) the
 * dashboard stays ≤ 1.5/min. The keyless public API's documented allowance is "5 to 15 calls per
 * minute, depending on usage conditions" (CoinGecko API docs, rate limits; the figure
 * `venues/context/payloads.ts` already records) — a documented limit, not one measured here. The
 * context collector's own CoinGecko calls (≤ 2/min, 30 s spacing) share that IP allowance.
 * No Binance weight.
 *
 * A failed read is not cached (`TtlCache`), so the next poll retries; the answer says which part
 * is missing (`source_unavailable`) instead of serving an empty list.
 */
export const CAPS_TOP_PER_PAGE = 250;
export const STABLECOINS_TTL_MS = 24 * 3_600_000;
const TIMEOUT_MS = 10_000;

export interface CapsServiceOptions {
  coingeckoBaseUrl: string;
  cache: TtlCache;
  cards: Pick<MarketCardsService, 'global'>;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class CapsService {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: CapsServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.now = options.now ?? Date.now;
  }

  async caps(period: WebMarketPeriod): Promise<WebCapsResponse> {
    const cg = this.options.coingeckoBaseUrl.replace(/\/$/, '');
    const [top, stablecoins, global] = await Promise.all([
      orNull(this.options.cache.getOrLoad('coingecko:markets:top', COINGECKO_TTL_MS, async (): Promise<CapsMarketRow[]> =>
        CapsMarketRowSchema.array().parse(await this.get(
          `${cg}/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${CAPS_TOP_PER_PAGE}&page=1&price_change_percentage=1h,24h,7d`,
        )))),
      orNull(this.options.cache.getOrLoad('coingecko:markets:stablecoins', STABLECOINS_TTL_MS, async (): Promise<StablecoinRow[]> =>
        StablecoinRowSchema.array().parse(await this.get(
          `${cg}/api/v3/coins/markets?vs_currency=usd&category=stablecoins&order=market_cap_desc&per_page=${CAPS_TOP_PER_PAGE}&page=1`,
        )))),
      this.options.cards.global().catch(() => null),
    ]);
    return assembleCaps({ period, top, stablecoins, global, nowMs: this.now() });
  }

  private async get(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}
