import type { BinanceRestKline } from '@trade-automation/binance-client';
import type { FundingRateRow, PremiumIndexRow } from './payloads';

/**
 * IB-005 — the REST calls this collector makes itself, beside the lifted kline paginator.
 *
 * Weight budget (design §4.5, D15):
 * - steady state: only gap repair calls REST (`/fapi/v1/klines`, weight 5 per repaired range) plus
 *   one `fundingRate` (weight 1) per symbol per settlement — **≈ 0.1 weight/min**;
 * - degraded mode (§16.1): `klines?limit=2` per symbol (weight 1) at 3 s for the signal set and
 *   15 s for the rest, plus one symbol-less `premiumIndex` (weight 10) per minute — **≈ 178
 *   weight/min for a 30-symbol universe, ~7 % of the 2400 budget**, and only while degraded.
 *
 * Every response's `x-mbx-used-weight-1m` header is reported through `onWeight`, which the
 * collector forwards to `MetricsService.setBinanceWeightUsed1m` (§6.1's `ib_binance_weight_used_1m`).
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface PerpRestOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Called with the venue's used-weight header value after every answered request. */
  onWeight?: (usedWeight1m: number) => void;
  /** Request timeout; a hung REST call must not stall the degraded poller. */
  timeoutMs?: number;
}

export const DEFAULT_REST_TIMEOUT_MS = 10_000;

export class PerpRest {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: PerpRestOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
  }

  /** The last `limit` 1m klines of one symbol — degraded mode's replacement for the kline stream. */
  async klines(symbol: string, limit = 2): Promise<BinanceRestKline[]> {
    return this.get<BinanceRestKline[]>(`/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
  }

  /** Mark price, index price and predicted funding for EVERY symbol in one call (weight 10). */
  async premiumIndex(): Promise<PremiumIndexRow[]> {
    const body = await this.get<PremiumIndexRow[] | PremiumIndexRow>('/fapi/v1/premiumIndex');
    return Array.isArray(body) ? body : [body];
  }

  /** The settled funding rate of one symbol, newest first (§4.1: fetched when `nextFundingTime` rolls). */
  async fundingRate(symbol: string, limit = 1): Promise<FundingRateRow[]> {
    return this.get<FundingRateRow[]>(`/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, { signal: controller.signal });
      const used = Number(response.headers.get('x-mbx-used-weight-1m'));
      if (Number.isFinite(used) && used > 0) this.options.onWeight?.(used);
      if (!response.ok) throw new Error(`Binance REST ${path} failed: ${response.status} ${response.statusText}`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
