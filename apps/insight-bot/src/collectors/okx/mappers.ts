import { FundingSettlementRow, LiquidationRow, MarkFundingRow, Source } from '../writers/tables';
import { ContractSpec, contractsToBase } from '../../venues/okx/contract-size';
import { OkxFundingHistoryRow, OkxFundingRate, OkxLiquidation, OkxMarkPrice } from './payloads';

/** The venue key stored in every row (§3.1). */
export const VENUE = 'okx';

function num(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`OKX payload: '${field}' is not a number (${String(value)})`);
  return parsed;
}

function at(ms: string | undefined, field: string): Date {
  const parsed = Number(ms);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`OKX payload: '${field}' is not a timestamp (${String(ms)})`);
  return new Date(parsed);
}

/**
 * `mark-price` → one `mark_funding_1m` row. `index_price` is **null**: the channel does not carry
 * one (see `payloads.ts`), and a copy of the mark would be a fabricated measurement.
 * `predicted_funding_rate` and `next_funding_time` come from the `funding-rate` channel and are
 * merged in by the collector, not invented here.
 */
export function markRow(event: OkxMarkPrice, source: Source = 'ws'): MarkFundingRow {
  return {
    venue: VENUE,
    symbol: event.instId,
    ts: at(event.ts, 'ts'),
    markPrice: num(event.markPx, 'markPx'),
    indexPrice: null,
    predictedFundingRate: null,
    nextFundingTime: null,
    source,
  };
}

/**
 * `funding-rate` → the predicted half of a `mark_funding_1m` row.
 *
 * `next_funding_time` takes **`fundingTime`**, the upcoming settlement — not `nextFundingTime`,
 * which is the interval after it. That is verified against the REST history in `payloads.ts`, and
 * `fundingTimeOf` below is the single place the choice is made.
 */
export function fundingTimeOf(event: OkxFundingRate): Date {
  return at(event.fundingTime, 'fundingTime');
}

export function predictedFundingRow(event: OkxFundingRate, source: Source = 'ws'): MarkFundingRow {
  return {
    venue: VENUE,
    symbol: event.instId,
    ts: at(event.ts, 'ts'),
    markPrice: null,
    indexPrice: null,
    predictedFundingRate: num(event.fundingRate, 'fundingRate'),
    nextFundingTime: fundingTimeOf(event),
    source,
  };
}

/**
 * The settled rate the `funding-rate` channel reports once an interval closes: `settState` flips
 * to `settled` and `settFundingRate` carries the realised number for `prevFundingTime`. Returns
 * null when the event does not describe a settlement, so the caller writes nothing rather than a
 * row of nulls.
 */
export function settlementRowFromWs(event: OkxFundingRate, source: Source = 'ws'): FundingSettlementRow | null {
  if (event.settState !== 'settled') return null;
  if (event.settFundingRate === undefined || event.settFundingRate === '') return null;
  if (event.prevFundingTime === undefined || event.prevFundingTime === '') return null;
  return {
    venue: VENUE,
    symbol: event.instId,
    fundingTime: at(event.prevFundingTime, 'prevFundingTime'),
    rate: num(event.settFundingRate, 'settFundingRate'),
    markPrice: null,
    source,
  };
}

/**
 * `/api/v5/public/funding-rate-history` → `funding_settlements`. Here `fundingTime` is a settled
 * interval (the opposite sense to the WS channel) and `realizedRate` is what was charged;
 * `fundingRate` is used only when the venue omits the realised figure.
 */
export function settlementRowsFromHistory(
  rows: readonly OkxFundingHistoryRow[],
  source: Source = 'rest',
): FundingSettlementRow[] {
  return rows.map((row) => ({
    venue: VENUE,
    symbol: row.instId,
    fundingTime: at(row.fundingTime, 'fundingTime'),
    rate: num(row.realizedRate !== undefined && row.realizedRate !== '' ? row.realizedRate : row.fundingRate, 'realizedRate'),
    markPrice: null,
    source,
  }));
}

/**
 * `liquidation-orders` → one `liquidations` row per detail.
 *
 * `side` is `posSide`, **the side that was liquidated** (§3.3), which the 45 s live sample proved
 * is always the inverse of the order's `side`. The invariant is asserted rather than assumed: if
 * OKX ever changes the convention, this throws instead of inverting every liquidation silently.
 *
 * `qty` is converted from contracts to base units; an instrument with no known contract size is
 * **skipped**, and reported through `onSkipped`, rather than written with a guessed size.
 */
export function liquidationRows(
  message: OkxLiquidation,
  specs: ReadonlyMap<string, ContractSpec>,
  onSkipped?: (instId: string, reason: string) => void,
  source: Source = 'ws',
): LiquidationRow[] {
  const spec = specs.get(message.instId);
  if (spec === undefined) {
    onSkipped?.(message.instId, 'no contract size known for this instrument');
    return [];
  }
  return message.details.map((detail) => {
    const expectedOrderSide = detail.posSide === 'long' ? 'sell' : 'buy';
    if (detail.side !== expectedOrderSide) {
      throw new Error(
        `OKX liquidation ${message.instId}: posSide='${detail.posSide}' with side='${detail.side}', expected ` +
          `'${expectedOrderSide}'. The venue's side convention changed — see payloads.ts, where it was measured.`,
      );
    }
    const price = num(detail.bkPx, 'bkPx');
    const qty = contractsToBase(detail.sz, spec);
    return {
      venue: VENUE,
      symbol: message.instId,
      ts: at(detail.ts, 'ts'),
      side: detail.posSide,
      price,
      qty,
      notional: price * qty,
      orderStatus: null,
      source,
    };
  });
}
