import { OkxFundingHistoryRow, OkxInstrument } from '../../collectors/okx/payloads';

/**
 * IB-009 — the two OKX REST endpoints this collector needs (design §4.3).
 *
 * **Single probe, 2026-09-28** on `/api/v5/public/funding-rate-history?instId=BTC-USDT-SWAP`
 * (AGENTS.md: one observation is a note, not a rule — these are page-shape facts the pager does
 * not depend on for correctness, since it stops on an empty page and on the retention edge
 * whatever the page size turns out to be):
 * - `limit=100` returned 100 rows spanning 2026-08-26 16:00 → 2026-09-28 16:00 (8 h intervals);
 * - **`after=<oldest fundingTime>` pages BACKWARD** — the next page came back
 *   2026-07-24 08:00 → 2026-08-26 08:00, i.e. strictly older;
 * - `limit=200` is also accepted and returns 200 rows. The design and the task both say 100 per
 *   page, which is what this uses; 200 is recorded here only so a later pass knows it can halve
 *   the request count without re-measuring.
 *
 * One gotcha worth writing down: a bare-`User-Agent` request to `www.okx.com` was answered
 * **HTTP 403** while the same URL via curl succeeded. Node's fetch sends its own UA and works;
 * if this ever starts 403-ing from a new runtime, that is the first thing to look at, not the
 * endpoint.
 */

export const FUNDING_PAGE_LIMIT = 100;
/** Guard against an endless walk if the venue ever stops honouring `after`. */
export const MAX_FUNDING_PAGES = 200;

export interface OkxRestOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface OkxEnvelope<T> {
  code: string;
  msg?: string;
  data?: T[];
}

export class OkxRest {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OkxRestOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}${path}?${new URLSearchParams(params).toString()}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`OKX ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    }
    const body = (await response.json()) as OkxEnvelope<T>;
    // OKX signals application errors in the body with `code !== '0'`, not by HTTP status.
    if (body.code !== '0') {
      throw new Error(`OKX ${path}: code ${body.code} ${body.msg ?? ''}`.trim());
    }
    return body.data ?? [];
  }

  /** Every SWAP instrument, for the contract-size table (`contract-size.ts`). */
  async instruments(): Promise<OkxInstrument[]> {
    return this.get<OkxInstrument>('/api/v5/public/instruments', { instType: 'SWAP' });
  }

  /**
   * Settled funding, newest page first, walking back with `after` until the caller's floor or the
   * venue's own wall — whichever comes first.
   *
   * **IB-BUG-003 folded IB-012's `okxFundingHistory` in here**, so the venue's paging, error
   * handling and retention edge live in one place. That copy existed because IB-012 needed this
   * endpoint while IB-009 was still in flight; its behaviour is preserved exactly, including the
   * two things callers depend on:
   *
   * - **`stopAtMs`** — rows older than the floor are dropped and the walk stops there. Without a
   *   floor the walk runs to the venue's wall, which is what the collector wants.
   * - **`reachedWall`** — true when the VENUE ran out of history, false when the walk stopped at
   *   the caller's own floor. IB-012 logs the difference, and the two are not interchangeable:
   *   a floor set inside the wall (its `OKX_FUNDING_DAYS = 97`, against a wall measured at ~98
   *   days) means the usual outcome is `false`.
   *
   * `after` is **exclusive**: page 2 with `after=<page 1's oldest>` does not repeat that row.
   * Measured 2026-09-28 per AGENTS.md's repetition rule — **5 trials on each of two occasions,
   * 21:11 and 21:16 UTC, exclusive 5/5 and 5/5.** So neither this nor the copy it replaces could
   * double-count; the de-dup on `fundingTime` below is belt-and-braces.
   *
   * Rows come back oldest-first.
   */
  async fundingHistory(
    instId: string,
    options: {
      /** Drop rows older than this and stop walking; omitted = walk to the venue's wall. */
      stopAtMs?: number;
      onPage?: (rows: OkxFundingHistoryRow[]) => void | Promise<void>;
    } = {},
  ): Promise<{ rows: OkxFundingHistoryRow[]; reachedWall: boolean }> {
    const stopAtMs = options.stopAtMs ?? Number.NEGATIVE_INFINITY;
    const byTime = new Map<number, OkxFundingHistoryRow>();
    let after: string | undefined;
    let previousOldest = Number.POSITIVE_INFINITY;
    let reachedWall = false;

    for (let page = 0; page < MAX_FUNDING_PAGES; page += 1) {
      const params: Record<string, string> = { instId, limit: String(FUNDING_PAGE_LIMIT) };
      if (after !== undefined) params.after = after;
      const rows = await this.get<OkxFundingHistoryRow>('/api/v5/public/funding-rate-history', params);
      if (rows.length === 0) {
        reachedWall = true; // the venue served nothing more
        break;
      }
      await options.onPage?.(rows);

      for (const row of rows) {
        const ms = Number(row.fundingTime);
        if (Number.isFinite(ms) && ms >= stopAtMs) byTime.set(ms, row);
      }

      const oldest = Math.min(...rows.map((row) => Number(row.fundingTime)));
      if (!Number.isFinite(oldest)) break;
      if (oldest <= stopAtMs || oldest >= previousOldest) {
        // Past the floor, or the page stopped advancing. The second case is the venue declining
        // to go further back, which IS the wall — but only if we had not already reached our own
        // floor, hence the comparison rather than a bare `true`.
        reachedWall = oldest > stopAtMs;
        break;
      }
      previousOldest = oldest;
      after = String(oldest);
    }

    return {
      rows: [...byTime.values()].sort((a, b) => Number(a.fundingTime) - Number(b.fundingTime)),
      reachedWall,
    };
  }
}
