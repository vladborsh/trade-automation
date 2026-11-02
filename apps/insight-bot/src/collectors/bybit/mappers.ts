import type { FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../writers/tables';
import type { BybitLiquidationEvent, BybitTickerData } from './payloads';
import type { BybitFundingHistoryRow } from '../../venues/bybit/payloads';

/** IB-008 — Bybit payload → §3.3 rows. Pure: every timestamp comes from the payload. */

export const VENUE = 'bybit';

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requiredNum(value: string, field: string): number {
  // `Number('')` is 0, so an empty string would slip through as a real zero price. A field the
  // venue left empty is missing data, not a zero — refuse it.
  const n = value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new RangeError(`${field}: expected a number, got ${JSON.stringify(value)}`);
  return n;
}

/**
 * A merged ticker state → one `mark_funding_1m` row, stamped by the caller (the minute boundary,
 * or the settlement second). `TickerState` does the snapshot+delta merge; this only maps.
 */
export function markRowFromTicker(symbol: string, data: BybitTickerData, ts: Date): MarkFundingRow {
  const next = num(data.nextFundingTime);
  return {
    venue: VENUE,
    symbol,
    ts,
    markPrice: num(data.markPrice),
    indexPrice: num(data.indexPrice),
    predictedFundingRate: num(data.fundingRate),
    nextFundingTime: next !== null && next > 0 ? new Date(next) : null,
    source: 'ws',
  };
}

/**
 * `allLiquidation` events → `liquidations` rows, side normalised to **the side liquidated** (§3.3).
 *
 * Bybit doc (read 2026-09-28): "S string Position side. Buy, Sell. When you receive a Buy update,
 * this means that a long position has been liquidated." So `Buy` → `long`, `Sell` → `short` —
 * the **inverse** of Binance's `!forceOrder`, where the engine's `SELL` closes a long. A spec
 * asserts both venues in one place so the inversion cannot be "tidied up" by accident.
 *
 * `p` is the bankruptcy price, not the mark: it is what the venue reports for the event, and the
 * notional below is therefore bankruptcy-priced. Bybit pushes this topic every 500 ms.
 */
export function liquidationRows(events: readonly BybitLiquidationEvent[]): LiquidationRow[] {
  return events.map((event) => {
    const price = requiredNum(event.p, 'allLiquidation.p');
    const qty = requiredNum(event.v, 'allLiquidation.v');
    return {
      venue: VENUE,
      symbol: event.s,
      ts: new Date(event.T),
      side: event.S === 'Buy' ? 'long' : 'short',
      price,
      qty,
      notional: price * qty,
      orderStatus: null, // Bybit does not report one on this topic
      source: 'ws',
    };
  });
}

/** `GET /v5/market/funding/history` row → a `funding_settlements` row. */
export function fundingSettlementRow(row: BybitFundingHistoryRow): FundingSettlementRow {
  return {
    venue: VENUE,
    symbol: row.symbol,
    fundingTime: new Date(requiredNum(row.fundingRateTimestamp, 'fundingRateTimestamp')),
    rate: requiredNum(row.fundingRate, 'fundingRate'),
    markPrice: null, // not in this payload; the mark row at the settlement second carries it
    source: 'rest',
  };
}
