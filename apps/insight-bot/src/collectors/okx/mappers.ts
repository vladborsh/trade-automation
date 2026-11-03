import { LiquidationRow, Source } from '../writers/tables';
import { ContractSpec, contractsToBase } from '../../venues/okx/contract-size';
import { OkxLiquidation } from './payloads';

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
