import type { WebFearGreedPoint, WebMarketCardsResponse } from '@trade-automation/contracts';
import type { FetchLike } from '../../venues/binance/rest.base';
import { fearGreedRows } from './context-mappers';
import { liveMarketCards } from './live-market-cards';
import {
  CoinMarketRowSchema, FngPayloadSchema, GlobalPayloadSchema, type CoinMarketRow, type GlobalPayload,
} from './market-cards.payloads';

/**
 * The market cards read LIVE from alternative.me and CoinGecko, nothing stored: the on-demand
 * direction of `tasks/wind-down.jsonl` (WD-009 keeps "the current snapshot, history parts
 * removed" as its default). When WD-008 lands its `TtlCache` and `VenuesModule`, this moves there.
 *
 * **Request rate**, however many pages are open, because each source is cached:
 *
 * | call | cache | at most |
 * |---|---|---|
 * | alternative.me `/fng/?limit=8` | 10 min | 0.1/min |
 * | CoinGecko `/api/v3/global` | 2 min | 0.5/min |
 * | CoinGecko `/api/v3/coins/markets?ids=<top 20>` | 2 min | 0.5/min |
 *
 * So at most one CoinGecko call a minute against its keyless allowance (~5–15/min, the figure
 * `venues/context/payloads.ts` records; not measured here). No Binance weight.
 *
 * **No retry and no back-off sleep**, unlike the collectors' `ContextClient`: a page is waiting.
 * A failed read serves the last good answer if there is one, else that card is null and the
 * page says it has no data, while the other cards still show.
 */
export const COINGECKO_TTL_MS = 120_000;
export const FNG_TTL_MS = 600_000;
const TIMEOUT_MS = 10_000;
/**
 * IB-102: 31 published days, in the SAME one request under the SAME key and TTL: the card's
 * sentences (today, the previous day, a week ago) plus the gauge's 30-day line. Still one request per
 * FNG_TTL_MS (≈ 0.1/min, 144 a day) whatever the page count; 31 small rows instead of 8 in memory.
 */
export const FNG_DAYS = 31;

export interface MarketCardsOptions {
  fngBaseUrl: string;
  coingeckoBaseUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface Slot<T> {
  at: number;
  value: T;
}

export class MarketCardsService {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly slots = new Map<string, Slot<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly options: MarketCardsOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.now = options.now ?? Date.now;
  }

  async cards(coins: readonly string[]): Promise<WebMarketCardsResponse> {
    const fng = this.options.fngBaseUrl.replace(/\/$/, '');
    const cg = this.options.coingeckoBaseUrl.replace(/\/$/, '');
    const ids = [...coins].sort().join(',');
    const [fearGreed, global, markets] = await Promise.all([
      this.cached('fng', FNG_TTL_MS, async (): Promise<WebFearGreedPoint[]> =>
        fearGreedRows(FngPayloadSchema.parse(await this.get(`${fng}/fng/?limit=${FNG_DAYS}`)) as never)
          .map((r) => ({ day: r.day, value: r.value, classification: r.classification }))),
      this.cached('global', COINGECKO_TTL_MS, async (): Promise<GlobalPayload> =>
        GlobalPayloadSchema.parse(await this.get(`${cg}/api/v3/global`))),
      ids.length === 0
        ? Promise.resolve(null)
        : this.cached(`markets:${ids}`, COINGECKO_TTL_MS, async (): Promise<CoinMarketRow[]> =>
          CoinMarketRowSchema.array().parse(
            await this.get(`${cg}/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids)}&per_page=${coins.length}`),
          )),
    ]);
    return liveMarketCards({ fearGreed, global, markets, coins, nowMs: this.now() });
  }

  /**
   * IB-087 — `/global` through the same 120 s slot the cards use, so the caps block's dominance bar
   * costs no extra CoinGecko call. Null when it has never been read successfully.
   */
  async global(): Promise<GlobalPayload | null> {
    const cg = this.options.coingeckoBaseUrl.replace(/\/$/, '');
    return this.cached('global', COINGECKO_TTL_MS, async (): Promise<GlobalPayload> =>
      GlobalPayloadSchema.parse(await this.get(`${cg}/api/v3/global`)));
  }

  /**
   * One source through its cache: fresh → the cached value; stale or absent → one shared read;
   * a failed read → the last good value however old, else null.
   */
  private async cached<T>(key: string, ttlMs: number, read: () => Promise<T>): Promise<T | null> {
    const slot = this.slots.get(key) as Slot<T> | undefined;
    if (slot && this.now() - slot.at < ttlMs) return slot.value;
    let pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = read();
      this.inFlight.set(key, pending);
    }
    try {
      const value = await pending;
      this.slots.set(key, { at: this.now(), value });
      return value;
    } catch {
      return slot?.value ?? null;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async get(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
    return response.json();
  }
}
