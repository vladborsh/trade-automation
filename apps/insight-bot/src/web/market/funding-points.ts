import type { WebFundingPoint } from '@trade-automation/contracts';
import type { FundingRateRow } from '../../venues/binance/payloads';
import type { BybitFundingHistoryRow } from '../../venues/bybit/payloads';
import type { OkxFundingHistoryRow } from '../../venues/okx/payloads';

/**
 * WD-008 — settled funding rows onto the wire, one function per venue, the SAME field each
 * collector stores (so the on-demand series and the tape agree): Binance `fundingRate`, Bybit
 * `fundingRate`, OKX `realizedRate` falling back to `fundingRate`. A row that is not a number
 * throws — the service reports that venue as unavailable rather than drawing a zero.
 *
 * Output: `[fromMs, toMs]`, oldest first, one point per settlement time (de-duplicated).
 */
export function binanceFundingPoints(rows: readonly FundingRateRow[], fromMs: number, toMs: number): WebFundingPoint[] {
  return points(rows.map((r) => [r.fundingTime, r.fundingRate]), fromMs, toMs, 'binance');
}

export function bybitFundingPoints(rows: readonly BybitFundingHistoryRow[], fromMs: number, toMs: number): WebFundingPoint[] {
  return points(rows.map((r) => [Number(r.fundingRateTimestamp), r.fundingRate]), fromMs, toMs, 'bybit');
}

export function okxFundingPoints(rows: readonly OkxFundingHistoryRow[], fromMs: number, toMs: number): WebFundingPoint[] {
  return points(
    rows.map((r) => [Number(r.fundingTime), r.realizedRate !== undefined && r.realizedRate !== '' ? r.realizedRate : r.fundingRate]),
    fromMs, toMs, 'okx',
  );
}

function points(pairs: ReadonlyArray<readonly [number, string]>, fromMs: number, toMs: number, venue: string): WebFundingPoint[] {
  const byTime = new Map<number, number>();
  for (const [ms, raw] of pairs) {
    if (!Number.isFinite(ms)) throw new Error(`${venue} funding: bad settlement time ${String(ms)}`);
    if (ms < fromMs || ms > toMs) continue;
    const rate = Number(raw);
    if (raw === '' || !Number.isFinite(rate)) throw new Error(`${venue} funding: rate is not a number (${String(raw)})`);
    byTime.set(Math.floor(ms / 1000), rate);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, rate]) => ({ time, rate }));
}
