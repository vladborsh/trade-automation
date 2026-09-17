import { Logger } from '@nestjs/common';
import { Instrument, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { MetricAdapter } from '../metric-adapter.port';
import {
  BinanceOpenInterestHistRow,
  BinanceOpenInterestSnapshot,
  mapOpenInterestHistRow,
  mapOpenInterestSnapshot,
} from './binance-metrics.mapper';

// architecture/chart-layouts.md §4.3 — `period` for openInterestHist; 5m is the finest grain
// the endpoint offers, matching the note's "history via openInterestHist at 5m".
const HIST_PERIOD = '5m';
// Binance's documented page size for openInterestHist (`limit` max), verified live below.
const HIST_PAGE_LIMIT = 500;

/**
 * openInterestHist retention — CONFIRMED LIVE against fapi.binance.com on 2026-09-12 (SE-4
 * build time), superseding the architecture note's "~30 days, unconfirmed": a request with
 * `startTime` more than 30 days in the past is rejected outright by the endpoint
 * (`{"msg":"parameter 'startTime' is invalid.","code":-1130}`), while `startTime` up to and
 * including 30 days back succeeds and returns data. So the venue's retention window is
 * **exactly ~30 days**, enforced as a parameter-validation error rather than an empty result.
 * `fetchObservations` clamps `from` to this window and logs when it does, per the note's D-
 * escalation pre-answer (b): if the venue's history is short, backfill what exists — this
 * constant does not need to be exact to the minute, only close enough that the clamp rarely
 * fires (the ingestion boot order already re-derives the real tail from `MetricStore`).
 *
 * architecture/panel-sync-and-oi-depth-diagnosis.md, Bug 2, defect 1 — CONFIRMED LIVE on
 * 2026-09-17 that this endpoint returns the **newest** `limit` rows inside `[startTime,
 * endTime]`, not the oldest: a request with `startTime = now-29d` came back spanning only the
 * last ~41h40m of that window. `fetchObservations` therefore paginates *backward* by shrinking
 * `endTime`, not forward by advancing `startTime` — walking forward silently returns only the
 * newest page every time, however wide `[from, to]` is.
 */
const HIST_RETENTION_MS = 30 * 24 * 60 * 60_000;

export class BinanceMetricsAdapter implements MetricAdapter {
  readonly venue = 'binance' as const;
  readonly supports: readonly MetricKind[] = ['openInterest'];
  private readonly logger = new Logger(BinanceMetricsAdapter.name);

  constructor(private readonly restBaseUrl: string) {}

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
}
