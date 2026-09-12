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
const HIST_PERIOD_MS = 5 * 60_000;
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
    let cursor = from;
    if (cursor < earliestAllowed) {
      this.logger.warn(
        `openInterestHist retention window (~30d) is shorter than requested for ${instrument.id}; ` +
          `clamping backfill start from ${new Date(from).toISOString()} to ${new Date(earliestAllowed).toISOString()}`,
      );
      cursor = earliestAllowed;
    }
    if (cursor > to) return [];

    const out: MetricObservation[] = [];
    while (cursor <= to) {
      const url = new URL('/futures/data/openInterestHist', this.restBaseUrl);
      url.searchParams.set('symbol', instrument.symbol);
      url.searchParams.set('period', HIST_PERIOD);
      url.searchParams.set('startTime', String(cursor));
      url.searchParams.set('endTime', String(to));
      url.searchParams.set('limit', String(HIST_PAGE_LIMIT));

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Binance openInterestHist request failed: ${res.status} ${res.statusText}`);
      }
      const rows = (await res.json()) as BinanceOpenInterestHistRow[];
      if (rows.length === 0) break;

      out.push(...rows.map((row) => mapOpenInterestHistRow(instrument.id, metric, row)));
      const lastTimestamp = rows[rows.length - 1].timestamp;
      if (rows.length < HIST_PAGE_LIMIT || lastTimestamp >= to) break;
      cursor = lastTimestamp + HIST_PERIOD_MS;
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
