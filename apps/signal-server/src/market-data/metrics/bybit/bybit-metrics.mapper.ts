import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';
import { TipPrice } from '../metric-adapter.port';

/** Every Bybit V5 response: `retCode` 0 = success; `time` is the venue's clock (ms). */
export interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

/**
 * One row of `GET /v5/market/open-interest` (strings on the wire). `openInterest` is the legacy
 * two-sided figure ("the sum of both sides"); `singleOpenInterest` is one-sided and present on
 * history rows back to at least 2023-11 (architecture/aggregate-oi.md §0).
 */
export interface BybitOpenInterestRow {
  openInterest: string;
  singleOpenInterest: string;
  timestamp: string;
}

export interface BybitOpenInterestResult {
  symbol: string;
  category: string;
  list: BybitOpenInterestRow[];
  nextPageCursor?: string;
}

/** One row of `GET /v5/market/mark-price-kline`: [startTime, open, high, low, close]. */
export type BybitMarkPriceKline = [string, string, string, string, string];

export interface BybitMarkPriceKlineResult {
  symbol: string;
  category: string;
  list: BybitMarkPriceKline[];
}

/** The fields of one `GET /v5/market/tickers?category=linear` entry this mapper reads. */
export interface BybitTicker {
  symbol: string;
  markPrice: string;
  openInterest: string;
  singleOpenInterest: string;
  /** = single × markPrice to the cent; not read (the tip is derived, §4), kept for reference. */
  singleOpenInterestValue: string;
}

export interface BybitTickersResult {
  category: string;
  list: BybitTicker[];
}

/** 5-minute bar length of both the OI history grain and the mark-price kline used for it. */
export const BYBIT_BAR_MS = 5 * 60_000;

/**
 * aggregate-oi.md §2 — the legacy `openInterest` is exactly 2 × `singleOpenInterest` (docs +
 * ratio 2.0000, verified 2026-09-18). Outside `2 ± 0.001` Bybit has changed a field's meaning:
 * the caller counts `metric_sidedness_drift_total{source}` and warns once per streak. A row with
 * a zero single side (no position at all) carries no ratio and is not a drift.
 */
export const SIDEDNESS_RATIO = 2;
export const SIDEDNESS_TOLERANCE = 0.001;

export function isSidednessDrift(openInterest: string, singleOpenInterest: string): boolean {
  const both = Number(openInterest);
  const single = Number(singleOpenInterest);
  if (!Number.isFinite(both) || !Number.isFinite(single)) return true;
  if (single === 0) return both !== 0;
  return Math.abs(both / single - SIDEDNESS_RATIO) > SIDEDNESS_TOLERANCE;
}

/**
 * aggregate-oi.md §0, §2 — `value` = `singleOpenInterest` (one-sided, base units) on every row,
 * old or new: the convention factor is applied at composition, never here. No notional —
 * history carries base units only; the adapter derives it from the mark-price bar (§4).
 */
export function mapOpenInterestRow(
  source: InstrumentId,
  metric: MetricKind,
  row: BybitOpenInterestRow,
): MetricObservation {
  return {
    metric,
    instrument: source,
    time: Number(row.timestamp),
    value: Number(row.singleOpenInterest),
    unit: 'base',
  };
}

/**
 * aggregate-oi.md §4 — a closed 5-minute mark-price bar as a price point stamped at its CLOSE
 * (`startTime + 5 m`). The join measurement (bybit-metrics.adapter.ts header) found that a
 * history row stamped `t` is the open interest at `t`, so its price is the close of the mark bar
 * ENDING at `t` — i.e. the point stamped exactly `t` here.
 */
export function mapMarkPriceKline(row: BybitMarkPriceKline): TipPrice {
  return { time: Number(row[0]) + BYBIT_BAR_MS, price: Number(row[4]) };
}

/**
 * aggregate-oi.md §4 live tip — `value` = `singleOpenInterest`; `notional` = single × the
 * ticker's `markPrice`, basis 'derived' — the SAME formula as history rows (single × Bybit's
 * mark), per the §4 pre-authorised rule after the join measurement (bybit-metrics.adapter.ts
 * header). Numerically it equals the venue's `singleOpenInterestValue` to the cent (0.0000 bps
 * over 943 polls). `time` is the response's top-level `time` (venue stamp — chart-layouts §4.2).
 */
export function mapTicker(
  source: InstrumentId,
  metric: MetricKind,
  venueTime: number,
  ticker: BybitTicker,
): MetricObservation {
  const value = Number(ticker.singleOpenInterest);
  return {
    metric,
    instrument: source,
    time: venueTime,
    value,
    unit: 'base',
    notional: value * Number(ticker.markPrice),
    notionalBasis: 'derived',
  };
}
