import { RETENTION_MS } from '../../venues/binance/futures-data.client';

/**
 * WD-008 — the pure half of `OiLsService`: which venue `period` a window is read at, and how a
 * window is cut to what Binance keeps.
 *
 * `/futures/data/*` serves these periods; 500 rows a page. A window is read at the finest period
 * that fits in `MAX_ROWS` (two pages), so a 1-day window gets 5-minute bars and a 30-day one hourly.
 */
export const PERIODS: ReadonlyArray<readonly [string, number]> = [
  ['5m', 5 * 60_000], ['15m', 15 * 60_000], ['30m', 30 * 60_000], ['1h', 3_600_000], ['2h', 7_200_000],
  ['4h', 14_400_000], ['6h', 21_600_000], ['12h', 43_200_000], ['1d', 86_400_000],
];
export const MAX_ROWS = 1_000;

export function periodFor(fromMs: number, toMs: number, minPeriodMs = 0): { period: string; periodMs: number } {
  const span = Math.max(0, toMs - fromMs);
  for (const [period, periodMs] of PERIODS) {
    // IB-118: a caller that needs no finer grain (the KPI tile's 7-day line: 168 hourly points, one
    // page) names a floor; without one, 7 days would be 672 points at 15 m over two pages
    if (periodMs < minPeriodMs) continue;
    if (Math.ceil(span / periodMs) <= MAX_ROWS) return { period, periodMs };
  }
  const [period, periodMs] = PERIODS[PERIODS.length - 1];
  return { period, periodMs };
}

export interface RetentionWindow {
  fromMs: number;
  toMs: number;
  /** True when `fromMs` was moved forward to the retention edge. */
  clipped: boolean;
  /** True when nothing of the window is inside retention: do not ask the venue at all. */
  empty: boolean;
}

/**
 * `fromMs` becomes `max(fromMs, now − RETENTION_MS)`. Asking for older data does not return less
 * of it: the venue refuses the whole request with -1130 (design text, IB-007/BUG-022 — see
 * `futures-data.client.ts` for how often it was observed and that the edge drifts by about a day).
 */
export function clipToRetention(fromMs: number, toMs: number, nowMs: number): RetentionWindow {
  const edge = nowMs - RETENTION_MS;
  if (toMs <= edge) return { fromMs: edge, toMs, clipped: true, empty: true };
  if (fromMs < edge) return { fromMs: edge, toMs, clipped: true, empty: false };
  return { fromMs, toMs, clipped: false, empty: false };
}

/**
 * IB-080 (storage ruling S3) — the venue answers wherever it still has data; stored rows answer only
 * for the part BEFORE the venue's first returned point. Pure: `stored` points at or after `boundaryMs`
 * are dropped (the venue wins inside its retention, even where the two disagree), so the joined line
 * has no duplicate and no overlap at the boundary. Both inputs are oldest-first; so is the output.
 */
export function joinAtBoundary<P extends { time: number }>(stored: readonly P[], venue: readonly P[], boundaryMs: number): P[] {
  return [...stored.filter((p) => p.time * 1000 < boundaryMs), ...venue];
}
