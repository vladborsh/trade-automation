import { globalFetch, responseText, type FetchLike } from '../fetch-like';
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
 * **CORRECTED 2026-09-28 by BUG-022's re-measurement — my IB-007 note above was half wrong.**
 * I wrote that the rejection is on `endTime` "not `startTime`", and that a too-old `startTime` is
 * "silently clamped". It is not. **Both parameters are validated**, each naming itself in the
 * `-1130` message, and the earlier signal-server comment I was contradicting was right about
 * `startTime` — it was merely incomplete, as mine then was about `endTime`.
 *
 * What misled me: the boundary **drifts**. Re-measuring, `startTime = now-31d` was rejected at
 * 21:01 UTC and accepted five times out of five at 21:04, with the edge sitting between 31 and 32
 * days. My single IB-007 probe straddled that moving edge and I generalised a venue rule from it.
 *
 * What survives unchanged, and is what this pager actually relies on:
 * 1. `-1130` is the **retention edge, not a failure** — how this endpoint says "no more history",
 *    so the walk ends cleanly on it.
 * 2. Past the data but still inside the valid window the venue returns an **empty array**, so the
 *    walk ends on that too. A pager that stops only on one of the two either spins or crashes.
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

/**
 * The numeric `code` of a Binance error body, or null. WD-008: parsed, not substring-matched — the
 * old `includes('"code":-1130')` missed the same body with a space after the colon. The refusal's
 * shape is pinned by `test/fixtures/binance/futures-data-retention-1130.json`.
 */
export function venueErrorCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown } | null;
    return typeof parsed?.code === 'number' ? parsed.code : null;
  } catch {
    return null;
  }
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
  /** Injectable for the specs; defaults to the global fetch. WD-008: `FetchLike`, not `typeof fetch`. */
  fetchImpl?: FetchLike;
}

/**
 * A minimal client for `https://fapi.binance.com/futures/data/*` — the five series IB-007 polls.
 * It is not in `libs/binance-client` because that library covers klines and the combined-stream
 * socket; if a second app ever needs these endpoints, this file is the thing to lift.
 */
export class FuturesDataClient {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: FuturesDataClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalFetch;
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
      const body = await responseText(response);
      if (venueErrorCode(body) === RETENTION_ERROR_CODE) {
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
