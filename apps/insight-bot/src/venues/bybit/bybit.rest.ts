import type { BybitFundingHistoryRow } from '../../collectors/bybit/payloads';

/**
 * IB-008 — the one REST endpoint this collector needs: settled funding history (§4.3).
 *
 * **Rate limit is Bybit's own, not Binance's.** Public v5 market endpoints allow far more than we
 * use, and nothing here touches `ib_binance_weight_used_1m` — that gauge is scoped to the 2400
 * Binance futures budget (design §4.5), and mixing venues into it would make it a lie.
 *
 * Usage: one page (≤ 200 rows) per symbol per settlement in steady state — 30 symbols every 8 h,
 * i.e. **~0.06 requests/min**. The boot backfill is the only burst; it stops as soon as it reaches
 * rows we already have.
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

export interface BybitRestOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export const DEFAULT_BASE_URL = 'https://api.bybit.com';
export const DEFAULT_TIMEOUT_MS = 15_000;
export const PAGE_LIMIT = 200;

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result?: { list?: T[] };
}

export class BybitRest {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: BybitRestOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * One page of settled funding, newest first. `endTime` pages **backwards**: the venue returns
   * the newest rows at or before it.
   */
  async fundingHistory(symbol: string, endTime?: number, limit = PAGE_LIMIT): Promise<BybitFundingHistoryRow[]> {
    const query = new URLSearchParams({ category: 'linear', symbol, limit: String(limit) });
    if (endTime !== undefined) query.set('endTime', String(endTime));
    const body = await this.get<BybitEnvelope<BybitFundingHistoryRow>>(`/v5/market/funding/history?${query}`);
    if (body.retCode !== 0) throw new Error(`Bybit funding/history ${symbol}: retCode ${body.retCode} ${body.retMsg}`);
    return body.result?.list ?? [];
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Bybit REST ${path} failed: ${response.status} ${response.statusText}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * How far back to page on boot: stop as soon as the venue's rows reach what we already stored, so
 * a restart costs one page per symbol instead of the full depth.
 *
 * Measured depth (probe, 2026-09-28, `category=linear`, 200 rows/page): **BTCUSDT 7 134 rows back
 * to 2020-03-25 (36 pages), ETHUSDT 6 505 back to 2020-10-21, SOLUSDT 6 112 back to 2021-06-29** —
 * i.e. the venue serves from listing, and a cold backfill of one symbol is ~30–36 requests.
 */
export function shouldPageFurther(oldestFetched: number, earliestStored: number | null, pagesDone: number, maxPages: number): boolean {
  if (pagesDone >= maxPages) return false;
  if (earliestStored === null) return true; // nothing stored: take the whole depth
  return oldestFetched > earliestStored;
}
