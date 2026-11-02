import type { BinanceRestKline } from '@trade-automation/binance-client';

/**
 * IB-006 — the REST mechanics both Binance collectors share: one `GET` with a timeout, the
 * `x-mbx-used-weight-1m` header reported back, and a thrown error carrying the status.
 *
 * **Only the mechanics are shared, never the budget.** USD-M (`fapi`) and spot (`api`) are metered
 * separately by the venue — 2400/min and 6000/min (design §4.5) — so each subclass reports its
 * weight through its own `onWeight`, into its own gauge. Adding a spot number to the futures gauge
 * would give a dashboard a figure that cannot be compared with its own ceiling.
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface BinanceRestOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Called with the venue's used-weight header value after every answered request. */
  onWeight?: (usedWeight1m: number) => void;
  /** Request timeout; a hung REST call must not stall the degraded poller. */
  timeoutMs?: number;
}

export const DEFAULT_REST_TIMEOUT_MS = 10_000;

export abstract class BinanceRest {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(protected readonly options: BinanceRestOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
  }

  protected async get<T>(path: string): Promise<T> {
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

  /** The last `limit` 1m klines of one symbol; the path differs per market (fapi vs api). */
  abstract klines(symbol: string, limit?: number): Promise<BinanceRestKline[]>;
}
