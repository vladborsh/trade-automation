import { Logger } from '@nestjs/common';
import { Instrument, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { MetricAdapter, TipPrice } from '../metric-adapter.port';
import { TIP_PRICE_MAX_AGE_MS } from '../tip-notional';
import {
  BinanceMarkPriceKline,
  BinanceOpenInterestHistRow,
  BinanceOpenInterestSnapshot,
  BinancePremiumIndex,
  mapMarkPriceKline,
  mapOpenInterestHistRow,
  mapOpenInterestSnapshot,
  mapPremiumIndex,
} from './binance-metrics.mapper';

// architecture/chart-layouts.md §4.3 — `period` for openInterestHist; 5m is the finest grain
// the endpoint offers, matching the note's "history via openInterestHist at 5m".
const HIST_PERIOD = '5m';
// Binance's documented page size for openInterestHist (`limit` max), verified live below.
const HIST_PAGE_LIMIT = 500;

/**
 * openInterestHist retention — **RE-MEASURED 2026-09-28 (BUG-022)**, correcting two earlier
 * comments that were each half right.
 *
 * What this endpoint actually does, from `fapi.binance.com`, BTCUSDT, `period=5m`. **5
 * repetitions at each boundary, on two occasions minutes apart** (21:01 and 21:04 UTC) — which
 * is what caught the drift in fact 2, and is now AGENTS.md's rule for any measured venue fact:
 *
 * | request | result |
 * |---|---|
 * | `startTime = now-30d` / `now-31d` | 200, rows |
 * | `startTime = now-32d` | **400 `{"msg":"parameter 'startTime' is invalid.","code":-1130}`** |
 * | `endTime = now-30d` | 200, 288 rows — the oldest data |
 * | `endTime = now-31d` | **200 with an EMPTY array** — valid request, no data left |
 * | `endTime = now-32d` | **400 `{"msg":"parameter 'endTime' is invalid.","code":-1130}`** |
 *
 * Three facts follow, and all three matter to the code below:
 *
 * 1. **BOTH parameters are validated**, each naming itself in the `-1130` message. The 2026-09-12
 *    comment here said `startTime`; IB-007 said `endTime`; neither was wrong, both were partial.
 * 2. **The boundary is not a crisp 30 days and it drifts.** Measured at 21:01 UTC, `now-31d` was
 *    rejected; at 21:04 the same request succeeded five times out of five and the edge sat
 *    between 31 and 32 days. So `HIST_RETENTION_MS` is a conservative clamp, not a truth: it must
 *    never be the only thing standing between this code and a `-1130`.
 * 3. **Past the data but inside the valid window the venue returns an empty array, not an error.**
 *    A pager that stops only on `-1130` spins on empty pages; one that stops only on empty
 *    crashes at the wall. This one stops on both.
 *
 * `-1130` is therefore treated as a **clean end of data**, the way IB-007's insight-bot client
 * does, rather than as a failed request — which is what it used to be, since any non-2xx threw
 * and would have aborted an entire backfill at the edge.
 *
 * architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 1 — CONFIRMED LIVE on
 * 2026-09-17 and unchanged: this endpoint returns the **newest** `limit` rows inside `[startTime,
 * endTime]`, not the oldest (a request with `startTime = now-29d` came back spanning only the
 * last ~41h40m). `fetchObservations` therefore paginates *backward* by shrinking `endTime`;
 * walking forward silently returns only the newest page every time, however wide the window.
 */
const HIST_RETENTION_MS = 30 * 24 * 60 * 60_000;

/*
 * architecture/chart-layouts.md §11.1 "The join check" — MEASURED 2026-09-18 (SE-A2), BTCUSDT,
 * 7925 stored openInterestHist rows 2026-08-18 16:10 → 2026-09-17 16:05 UTC. Implied price
 * `sumOpenInterestValue / sumOpenInterest` per row, compared with:
 *   (a) our last-trade 1m close, bar ending at the row stamp:  median |Δ| 0.14 bps, p99 3.67 bps
 *   (b) Binance 1m mark price close (markPriceKlines, 29 one-off calls), bar ending at the stamp:
 *       median |Δ| 0.00 bps, p99 0.00 bps (19 of 7925 rows > 0.01 bps, max 1.93 bps) — i.e.
 *       Binance computes sumOpenInterestValue = sumOpenInterest × mark price at the stamp.
 * Step at the history/tip join, |notional − value × price|, vs the median |5 m ΔOI_usd| of
 * 4.89 M USDT: last-trade median 115 k (2.4 %), p90 23 %, p99 3.0 M (62 %); mark 0 %.
 * DECISION (architect, chart-layouts §11.1, overriding the median-only rule because the tail
 * step — a visible notch one join in ten — breaks its "< 10 % of the move" intent): the live
 * tip uses MARK PRICE, `fetchTipPrice` → /fapi/v1/premiumIndex in the same 60 s poll as
 * /fapi/v1/openInterest (weight 1 → +1 weight/min per instrument, ≈0.04 % of 2400/min; no new
 * loop). Same basis as the venue's figure → no step at the join by construction. The legacy
 * repair uses 1m markPriceKlines (`fetchTipPriceHistory`, below).
 */

/**
 * markPriceKlines page: 1500 rows is the endpoint's max `limit`, request weight 10 at that
 * size (Binance: limit > 1000 → 10). The repair runs once per boot over rows still lacking
 * notional only: a full 30-day window is ⌈43200 / 1500⌉ = 29 calls = 290 weight, paced one call
 * per MARK_KLINES_PACING_MS so it spreads over ~30 s instead of bursting (< 13 % of one
 * minute's 2400 budget, once). Sparse legacy stretches cost fewer calls: one page per 25 h run.
 */
const MARK_KLINES_PAGE_LIMIT = 1500;
const MARK_KLINES_PACING_MS = 1000;
const ONE_MINUTE_MS = 60_000;

export class BinanceMetricsAdapter implements MetricAdapter {
  readonly venue = 'binance' as const;
  readonly supports: readonly MetricKind[] = ['openInterest'];
  private readonly logger = new Logger(BinanceMetricsAdapter.name);

  constructor(
    private readonly restBaseUrl: string,
    private readonly markKlinesPacingMs: number = MARK_KLINES_PACING_MS,
  ) {}

  async fetchObservations(
    instrument: Instrument,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]> {
    const earliestAllowed = Date.now() - HIST_RETENTION_MS;
    let effectiveFrom = from;
    if (effectiveFrom < earliestAllowed) {
      this.logger.warn(
        `openInterestHist retention window (~30d) is shorter than requested for ${instrument.id}; ` +
          `clamping backfill start from ${new Date(from).toISOString()} to ${new Date(earliestAllowed).toISOString()}`,
      );
      effectiveFrom = earliestAllowed;
    }
    if (effectiveFrom > to) return [];

    // Paginate BACKWARD by shrinking `endTime` — see HIST_RETENTION_MS's comment above for why:
    // the venue returns the newest `limit` rows of `[startTime, endTime]`, so each page's own
    // *first* row is the next `endTime` to ask for, and pages are prepended (oldest-page-last on
    // the wire, but each individual page is itself ascending) to keep the final result ascending.
    const out: MetricObservation[] = [];
    let cursorEnd = to;
    while (cursorEnd >= effectiveFrom) {
      const url = new URL('/futures/data/openInterestHist', this.restBaseUrl);
      url.searchParams.set('symbol', instrument.symbol);
      url.searchParams.set('period', HIST_PERIOD);
      url.searchParams.set('startTime', String(effectiveFrom));
      url.searchParams.set('endTime', String(cursorEnd));
      url.searchParams.set('limit', String(HIST_PAGE_LIMIT));

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        if (body.includes('"code":-1130')) {
          // BUG-022: the retention wall, not a failure. The window drifts, so a page that was
          // inside it when the clamp was computed can be outside it by the time it is requested.
          // Ending the walk here returns what was collected; throwing would lose the whole
          // backfill to a boundary that moves on its own.
          this.logger.warn(
            `openInterestHist reached the venue's retention wall for ${instrument.id} ` +
              `(${body.slice(0, 120)}); keeping the ${out.length} observation(s) already fetched`,
          );
          break;
        }
        throw new Error(`Binance openInterestHist request failed: ${res.status} ${res.statusText}`);
      }
      const rows = (await res.json()) as BinanceOpenInterestHistRow[];
      if (rows.length === 0) break;

      out.unshift(...rows.map((row) => mapOpenInterestHistRow(instrument.id, metric, row)));
      const firstTimestamp = rows[0].timestamp;
      if (rows.length < HIST_PAGE_LIMIT || firstTimestamp <= effectiveFrom) break;
      cursorEnd = firstTimestamp - 1;
    }

    return out;
  }

  async fetchLatest(instrument: Instrument, metric: MetricKind): Promise<MetricObservation> {
    const url = new URL('/fapi/v1/openInterest', this.restBaseUrl);
    url.searchParams.set('symbol', instrument.symbol);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Binance openInterest request failed: ${res.status} ${res.statusText}`);
    }
    const snapshot = (await res.json()) as BinanceOpenInterestSnapshot;
    return mapOpenInterestSnapshot(instrument.id, metric, snapshot);
  }

  /** §11.1 — the current mark price (see the join-check header above). */
  async fetchTipPrice(instrument: Instrument): Promise<TipPrice> {
    const url = new URL('/fapi/v1/premiumIndex', this.restBaseUrl);
    url.searchParams.set('symbol', instrument.symbol);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Binance premiumIndex request failed: ${res.status} ${res.statusText}`);
    }
    return mapPremiumIndex((await res.json()) as BinancePremiumIndex);
  }

  /**
   * §11.1 legacy-row repair — 1m mark-price bars covering `[t − 120 s, t]` for each `t`: a page
   * starts at the first uncovered row's `t − 180 s` (the earliest bar that can close in its
   * window) and spans up to 1500 bars; every row whose bar falls inside that page is covered by
   * it, so gaps between sparse legacy stretches are skipped rather than fetched. Weight/pacing:
   * see MARK_KLINES_PAGE_LIMIT.
   */
  async fetchTipPriceHistory(instrument: Instrument, times: readonly number[]): Promise<TipPrice[]> {
    const out: TipPrice[] = [];
    let i = 0;
    let calls = 0;
    while (i < times.length) {
      const startTime = times[i] - TIP_PRICE_MAX_AGE_MS - ONE_MINUTE_MS;
      const endTime = startTime + MARK_KLINES_PAGE_LIMIT * ONE_MINUTE_MS - 1;
      if (calls > 0 && this.markKlinesPacingMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.markKlinesPacingMs));
      }

      const url = new URL('/fapi/v1/markPriceKlines', this.restBaseUrl);
      url.searchParams.set('symbol', instrument.symbol);
      url.searchParams.set('interval', '1m');
      url.searchParams.set('startTime', String(startTime));
      url.searchParams.set('endTime', String(endTime));
      url.searchParams.set('limit', String(MARK_KLINES_PAGE_LIMIT));
      const res = await fetch(url);
      calls++;
      if (!res.ok) {
        throw new Error(`Binance markPriceKlines request failed: ${res.status} ${res.statusText}`);
      }
      const rows = (await res.json()) as BinanceMarkPriceKline[];
      for (const row of rows) {
        const point = mapMarkPriceKline(row);
        if (out.length === 0 || point.time > out[out.length - 1].time) out.push(point);
      }
      // A row's newest usable bar opens at t − 1m; rows whose bar opens past this page move on.
      while (i < times.length && times[i] - ONE_MINUTE_MS <= endTime) i++;
    }
    this.logger.log(`markPriceKlines: ${calls} call(s) (≤ ${calls * 10} weight) for ${times.length} rows of ${instrument.id}`);
    return out;
  }
}
