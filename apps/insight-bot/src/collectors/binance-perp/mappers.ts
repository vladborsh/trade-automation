import type { FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../writers/tables';
import type { ForceOrderEvent, FundingRateRow, MarkPriceEvent, PremiumIndexRow } from './payloads';
import { VENUE } from '../binance-common/venue';

/**
 * IB-005 — pure payload → row mappers for the Binance USD-M perp collector (design §4.1, §3.3).
 * No clock, no I/O: every timestamp comes from the payload, as §1's cmc-bot-main bug demands.
 */

// IB-006: the constant moved to `binance-common/venue.ts` (spot writes the same venue); imported
// and re-exported here so every existing `from './mappers'` import is unchanged.
export { VENUE };

/** A number the venue sent as a string; `null` for absent or unparseable, never 0. */
function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Same, for a field the row requires. */
function requiredNum(value: string, field: string): number {
  // `Number('')` is 0, so an empty string would slip through as a real zero price. A field the
  // venue left empty is missing data, not a zero — refuse it.
  const n = value === '' ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new RangeError(`${field}: expected a number, got ${JSON.stringify(value)}`);
  return n;
}

/**
 * `markPriceUpdate` → a `mark_funding_1m` row, stamped `ts`. The caller decides the stamp: the
 * minute boundary for the per-minute sample (D5), or the settlement second for the last prediction
 * before a funding settlement (§4.1) — the event's own `E` is never the row's time.
 */
export function markRowFromEvent(event: MarkPriceEvent, ts: Date, source: MarkFundingRow['source'] = 'ws'): MarkFundingRow {
  return {
    venue: VENUE,
    symbol: event.s,
    ts,
    markPrice: num(event.p),
    indexPrice: num(event.i),
    predictedFundingRate: num(event.r),
    nextFundingTime: event.T > 0 ? new Date(event.T) : null,
    source,
  };
}

/** `GET /fapi/v1/premiumIndex` row → the same shape, for degraded mode (§16.1). */
export function markRowFromPremiumIndex(row: PremiumIndexRow, ts: Date): MarkFundingRow {
  return {
    venue: VENUE,
    symbol: row.symbol,
    ts,
    markPrice: num(row.markPrice),
    indexPrice: num(row.indexPrice),
    predictedFundingRate: num(row.lastFundingRate),
    nextFundingTime: row.nextFundingTime > 0 ? new Date(row.nextFundingTime) : null,
    source: 'rest',
  };
}

/**
 * `forceOrder` → a `liquidations` row. **Side is normalised to the side LIQUIDATED**: the engine
 * submits a SELL to close a long, so `S = SELL` is a `long` liquidation and `BUY` a `short` one
 * (§3.3, D6). Binance publishes at most one such event per second per symbol, so these rows
 * undercount — documented on the table and repeated here where the mapping happens.
 */
export function liquidationRowFromEvent(event: ForceOrderEvent): LiquidationRow {
  const o = event.o;
  const price = requiredNum(o.ap && o.ap !== '0' ? o.ap : o.p, 'forceOrder price');
  const qty = requiredNum(o.z && o.z !== '0' ? o.z : o.q, 'forceOrder qty');
  return {
    venue: VENUE,
    symbol: o.s,
    ts: new Date(o.T),
    side: o.S === 'SELL' ? 'long' : 'short',
    price,
    qty,
    notional: price * qty,
    orderStatus: o.X ?? null,
    source: 'ws',
  };
}

/** `GET /fapi/v1/fundingRate` row → a `funding_settlements` row (§4.1). */
export function fundingSettlementRow(row: FundingRateRow): FundingSettlementRow {
  return {
    venue: VENUE,
    symbol: row.symbol,
    fundingTime: new Date(row.fundingTime),
    rate: requiredNum(row.fundingRate, 'fundingRate'),
    markPrice: num(row.markPrice),
    source: 'rest',
  };
}
