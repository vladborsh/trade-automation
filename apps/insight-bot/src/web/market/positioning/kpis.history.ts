import type { WebFundingPoint, WebKpiHistory } from '@trade-automation/contracts';
import type { MarketCapRow } from '../pg/market-cap.repo';

/**
 * IB-118 (market round 2 §2) — the KPI tiles' 7-day series, pure. Each takes what its source already
 * returned and states what it covers: `from`/`to` are the first and last point actually held, never
 * the window asked for, so a short span is named rather than drawn as seven days.
 */
export const KPI_HISTORY_MS = 7 * 24 * 3_600_000;
/** Our own table: under this much of it, no chart — «копим историю: {h} ч». */
export const CAP_MIN_SPAN_MS = 6 * 3_600_000;
/** A gap over 30 min between two cap rows (three missed 10-min ticks) breaks the line. */
export const CAP_BREAK_AFTER_SEC = 30 * 60;
/** OI is read at 1 h: a missing hour (two points 2 h apart) breaks the line, an on-time one does not. */
export const OI_PERIOD_MS = 3_600_000;
export const OI_BREAK_AFTER_SEC = 1.5 * 3_600;
/** The funding tile's bars: the last 21 settlements, seven days at Binance's 8 h. */
export const FUNDING_BARS = 21;

export function history(kind: WebKpiHistory['kind'], raw: ReadonlyArray<{ time: number; value: number | null }>, breakAfterSec: number | null): WebKpiHistory | null {
  const points = raw.filter((p): p is { time: number; value: number } => p.value !== null && Number.isFinite(p.value));
  if (points.length === 0) return null;
  let min = points[0].value;
  let max = points[0].value;
  for (const p of points) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  return { kind, points, from: points[0].time, to: points[points.length - 1].time, min, max, breakAfterSec };
}

/**
 * Market cap from `market_cap_total` (rows of the last 7 days, oldest first). Under 6 h between the
 * first and last row there is no chart: `collectingHours` says how much is held (whole hours, floor).
 */
export function capHistory(rows: readonly MarketCapRow[]): { history: WebKpiHistory | null; collectingHours: number | null } {
  const span = rows.length === 0 ? 0 : rows[rows.length - 1].tsMs - rows[0].tsMs;
  if (span < CAP_MIN_SPAN_MS) return { history: null, collectingHours: Math.floor(span / 3_600_000) };
  return { history: history('area', rows.map((r) => ({ time: Math.floor(r.tsMs / 1000), value: r.totalUsd })), CAP_BREAK_AFTER_SEC), collectingHours: null };
}

/** BTC OI in USD (the tile's own unit, `sumOpenInterestValue`) from the 7-day hourly read. */
export function oiHistory(points: ReadonlyArray<{ time: number; notional: number | null }>): WebKpiHistory | null {
  return history('area', points.map((p) => ({ time: p.time, value: p.notional })), OI_BREAK_AFTER_SEC);
}

/** BTC funding: the last 21 settlements of the positioning baseline, one bar each. */
export function fundingHistory(settlements: readonly WebFundingPoint[]): WebKpiHistory | null {
  return history('bars', settlements.slice(-FUNDING_BARS).map((p) => ({ time: p.time, value: p.rate })), null);
}
