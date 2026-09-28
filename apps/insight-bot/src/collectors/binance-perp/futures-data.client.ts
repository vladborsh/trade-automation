import { BinanceWeightTracker } from './binance-weight.tracker';

/** Binance's max `limit` for the `/futures/data` series endpoints. */
export const PAGE_LIMIT = 500;

/**
 * The venue's retention for these series, **measured 2026-09-28 (IB-007)** by walking `endTime`
 * backward on `openInterestHist`:
 *
 * | `endTime` | result |
 * |---|---|
 * | now − 29 d | 500 rows |
 * | now − 30 d | 288 rows, oldest 2026-08-28 13:40 |
 * | now − 31 d | **HTTP 400 `{"code":-1130,"msg":"parameter 'endTime' is invalid."}`** |
 *
 * Two corrections to what `apps/signal-server/.../binance-metrics.adapter.ts` recorded in
 * 2026-09 and what IB-007's task text repeats:
 * 1. The rejection is on **`endTime`**, not `startTime`. A `startTime` 31 days back is now
 *    accepted and silently clamped — it came back with the newest page, no error. A backfill
 *    that expects `-1130` from `startTime` would therefore never stop.
 * 2. `-1130` is the **retention edge, not a failure**: it is how this endpoint says "there is
 *    no more history", so the pager treats it as a clean end of data.
 *
 * Unchanged and re-confirmed: the endpoint returns the **newest** `limit` rows inside the
 * window, so history is paged **backward** by shrinking `endTime`.
 */
export const RETENTION_MS = 30 * 24 * 60 * 60_000;
export const RETENTION_ERROR_CODE = -1130;

/** Weight assumed per `/futures/data` call for D15's budget. */
export const CALL_WEIGHT = 1;

export interface FuturesDataQuery {
  endpoint: string;
  symbol: string;
  period?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

/** Thrown when the venue says the requested window is past its retention (`-1130`). */
export class RetentionEdgeError extends Error {
  constructor(readonly endpoint: string, readonly symbol: string) {
    super(`Binance ${endpoint}: requested window is past the ~30-day retention edge (${RETENTION_ERROR_CODE})`);
    this.name = 'RetentionEdgeError';
  }
}

export interface FuturesDataClientOptions {
  baseUrl: string;
  weight: BinanceWeightTracker;
  /** Injectable for the specs; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * A minimal client for `https://fapi.binance.com/futures/data/*` — the five series IB-007 polls.
 * It is not in `libs/binance-client` because that library covers klines and the combined-stream
 * socket; if a second app ever needs these endpoints, this file is the thing to lift.
 */
export class FuturesDataClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: FuturesDataClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  buildUrl(query: FuturesDataQuery): string {
    const params = new URLSearchParams({ symbol: query.symbol });
    if (query.period !== undefined) params.set('period', query.period);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.startTime !== undefined) params.set('startTime', String(query.startTime));
    if (query.endTime !== undefined) params.set('endTime', String(query.endTime));
    return `${this.options.baseUrl.replace(/\/$/, '')}/futures/data/${query.endpoint}?${params.toString()}`;
  }

  /** One page. Throws `RetentionEdgeError` on -1130; any other non-2xx is an ordinary error. */
  async fetchPage<T>(query: FuturesDataQuery): Promise<T[]> {
    const response = await this.fetchImpl(this.buildUrl(query));
    // Counted whatever the outcome: a rejected request still cost the venue's rate limiter.
    this.options.weight.recordCall(CALL_WEIGHT);
    this.options.weight.recordFromHeaders(response.headers);

    if (!response.ok) {
      const body = await response.text();
      if (body.includes(`"code":${RETENTION_ERROR_CODE}`)) {
        throw new RetentionEdgeError(query.endpoint, query.symbol);
      }
      throw new Error(`Binance ${query.endpoint} ${query.symbol}: HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    const payload = (await response.json()) as T[];
    if (!Array.isArray(payload)) {
      throw new Error(`Binance ${query.endpoint} ${query.symbol}: expected an array, got ${typeof payload}`);
    }
    return payload;
  }

  /**
   * Pages backward from `endTime` until the window is covered or the venue runs out of history.
   * Stops on: an empty page, the retention edge (`-1130`), a page whose oldest row is not older
   * than the previous page's (which would loop forever), or reaching `from`.
   *
   * Returns rows oldest-first, de-duplicated by timestamp.
   */
  async fetchBackward<T extends { timestamp: number }>(
    query: Omit<FuturesDataQuery, 'startTime' | 'endTime'>,
    from: number,
    to: number,
    onPage?: (rows: T[]) => void | Promise<void>,
  ): Promise<T[]> {
    const limit = query.limit ?? PAGE_LIMIT;
    const byTimestamp = new Map<number, T>();
    let endTime = to;
    let previousOldest = Number.POSITIVE_INFINITY;

    for (;;) {
      let page: T[];
      try {
        page = await this.fetchPage<T>({ ...query, limit, endTime });
      } catch (err) {
        if (err instanceof RetentionEdgeError) break; // the venue has no more history: a clean end
        throw err;
      }
      if (page.length === 0) break;

      await onPage?.(page); // the caller's pacing, awaited — a fire-and-forget call would not pace at all
      for (const row of page) byTimestamp.set(row.timestamp, row);

      const oldest = Math.min(...page.map((row) => row.timestamp));
      if (oldest <= from || oldest >= previousOldest) break;
      previousOldest = oldest;
      endTime = oldest - 1; // strictly older, so the next page cannot repeat this one's oldest row
    }

    return [...byTimestamp.values()]
      .filter((row) => row.timestamp >= from && row.timestamp <= to)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
