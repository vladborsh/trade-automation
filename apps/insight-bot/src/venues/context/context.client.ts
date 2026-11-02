import type { CoingeckoGate, CoingeckoPriority } from './coingecko.gate';
import { FngPayload, GlobalPayload, MarketChartPayload } from './payloads';

/** The task's back-off: retry after 60 s, at most 3 times. */
export const RETRY_AFTER_MS = 60_000;
export const MAX_RETRIES = 3;
/** CoinGecko's free window for a coin's chart; `days=max` is paid (401, error 10012). */
export const COIN_CHART_DAYS = 365;

export interface ContextClientOptions {
  fngBaseUrl: string;
  coingeckoBaseUrl: string;
  fetchImpl?: typeof fetch;
  /** Injected so the specs do not really wait 60 s. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called on every 429 before backing off. **Not optional in spirit**: a silent retry is how a
   * collector reports "normal" while running at a fraction of its configured pace — measured
   * 2026-09-28, a backfill spent roughly three quarters of its wall time in back-off and logged
   * nothing at all.
   */
  onRetry?: (info: { url: string; attempt: number; of: number; waitMs: number }) => void;
  /**
   * IB-BUG-006 — the queue in front of CoinGecko. Only the CoinGecko calls pass through it;
   * alternative.me is a different host with its own allowance, and putting it in this queue would
   * make the Fear & Greed poll wait on a backfill it has nothing to do with.
   */
  gate?: CoingeckoGate;
}

/**
 * IB-036 — the keyless client for alternative.me and CoinGecko (§10).
 *
 * **429 is the only retried status.** A 401 is not a transient failure here, it is the venue
 * saying the endpoint is paid — retrying it three times would just be three ways of being told
 * no — so it fails immediately with a message naming the two endpoints that do this, because
 * that is the mistake a future reader is most likely to make.
 */
export class ContextClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: ContextClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async getJson<T>(url: string, priority?: CoingeckoPriority): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      // IB-BUG-006: ONE ATTEMPT per gate slot. The back-off below happens outside the gate, so a
      // backfill call sleeping off a 429 releases its place and the forward-only poll can take
      // the next slot — holding the slot across the retry would reproduce the starvation inside
      // the fix meant to remove it.
      const response = await this.run(priority, () => this.fetchImpl(url));
      if (response.ok) return (await response.json()) as T;

      if (response.status === 429 && attempt < MAX_RETRIES) {
        this.options.onRetry?.({ url, attempt: attempt + 1, of: MAX_RETRIES, waitMs: RETRY_AFTER_MS });
        // the allowance is shared, so the pause is the whole gate's, not this caller's alone
        if (priority !== undefined) this.options.gate?.backOff(RETRY_AFTER_MS);
        await this.sleep(RETRY_AFTER_MS);
        continue;
      }
      const body = (await response.text()).slice(0, 200);
      if (response.status === 401) {
        throw new Error(
          `${url}: HTTP 401 — this endpoint needs a paid key. The free tier covers /global and ` +
            `market_chart up to ${COIN_CHART_DAYS} days; /global/market_cap_chart and days=max do not. ${body}`,
        );
      }
      throw new Error(`${url}: HTTP ${response.status} ${body}`);
    }
  }

  /** Runs a single request in its gate slot; without a gate (the specs, and alternative.me) it is
   * the bare call. */
  private run(priority: CoingeckoPriority | undefined, fn: () => Promise<Response>): Promise<Response> {
    const gate = this.options.gate;
    return priority === undefined || gate === undefined ? fn() : gate.run(priority, fn);
  }

  /** `limit=0` is the whole history since 2018; `limit=2` is the daily poll. */
  async fearGreed(limit: number): Promise<FngPayload> {
    return this.getJson<FngPayload>(`${this.options.fngBaseUrl.replace(/\/$/, '')}/fng/?limit=${limit}`);
  }

  /** Forward-only: a sample missed here is missed for ever, so it goes ahead of queued backfill. */
  async global(): Promise<GlobalPayload> {
    return this.getJson<GlobalPayload>(`${this.options.coingeckoBaseUrl.replace(/\/$/, '')}/api/v3/global`, 'forward-only');
  }

  async coinMarketChart(coin: string, days: number): Promise<MarketChartPayload> {
    const base = this.options.coingeckoBaseUrl.replace(/\/$/, '');
    return this.getJson<MarketChartPayload>(
      `${base}/api/v3/coins/${encodeURIComponent(coin)}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
      'backfill',
    );
  }
}
