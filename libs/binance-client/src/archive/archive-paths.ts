/**
 * IB-012 — where each series lives on data.binance.vision, and how far back it actually goes
 * (§5, and the corrections the Architect measured).
 *
 * The depth floors are the load-bearing part. A backfill that asks for a month a venue never
 * served gets a 404, and if that 404 is recorded as a hole it lands in the daily gap report as a
 * permanent red line — the exact "crying wolf" failure IB-011 is built to avoid. So absence
 * BEFORE a floor is a fact about the venue, not a gap; absence after it is a real hole.
 */

export const ARCHIVE_BASE = 'https://data.binance.vision/data';

export type ArchiveSeries = 'klines-perp' | 'klines-spot' | 'funding' | 'metrics';

/**
 * First month/day each series is served, measured — not assumed.
 *
 * - `metrics`: **BTCUSDT from 2020-09-01, every other symbol from 2021-12-01** (404 before that,
 *   measured in `research/squeeze-full-form/`). Only the daily prefix exists at all: the monthly
 *   metrics prefix is a 404 for every symbol/month probed
 *   (`research/deriv-positioning/fetch_metrics.py`).
 * - `funding`: 2020-01 (verified 0 missing slots on 8 symbols in `research/funding-rate-signals`).
 * - klines: from the symbol's own listing, so there is no single floor — the caller passes it.
 */
export const METRICS_FLOOR_DEFAULT = '2021-12-01';
export const METRICS_FLOOR_BY_SYMBOL: Readonly<Record<string, string>> = { BTCUSDT: '2020-09-01' };
export const FUNDING_FLOOR = '2020-01';

/** The first day the 5-minute metrics archive serves this symbol. */
export function metricsFloor(symbol: string): string {
  return METRICS_FLOOR_BY_SYMBOL[symbol] ?? METRICS_FLOOR_DEFAULT;
}

/** Monthly 1m klines. `market` picks the perp (`futures/um`) or the spot tree. */
export function monthlyKlinesUrl(market: 'perp' | 'spot', symbol: string, month: string): string {
  const tree = market === 'perp' ? 'futures/um' : 'spot';
  return `${ARCHIVE_BASE}/${tree}/monthly/klines/${symbol}/1m/${symbol}-1m-${month}.zip`;
}

/** Daily 1m klines — the current month, which has no monthly file yet. */
export function dailyKlinesUrl(market: 'perp' | 'spot', symbol: string, day: string): string {
  const tree = market === 'perp' ? 'futures/um' : 'spot';
  return `${ARCHIVE_BASE}/${tree}/daily/klines/${symbol}/1m/${symbol}-1m-${day}.zip`;
}

/** Monthly settled funding rates (USD-M perp only). */
export function monthlyFundingUrl(symbol: string, month: string): string {
  return `${ARCHIVE_BASE}/futures/um/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`;
}

/**
 * Daily 5-minute metrics (open interest and the four long/short ratios).
 * Daily only, on purpose: the monthly prefix does not exist (measured, see above).
 */
export function dailyMetricsUrl(symbol: string, day: string): string {
  return `${ARCHIVE_BASE}/futures/um/daily/metrics/${symbol}/${symbol}-metrics-${day}.zip`;
}
