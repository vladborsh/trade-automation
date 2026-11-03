import { ContractSpec } from '../../venues/okx/contract-size';
import { FundingSettlementRow, LiquidationRow, MarkFundingRow } from '../writers/tables';
import { step, writeIsolated, WriteFailure } from '../writers/write-isolated';
import {
  fundingTimeOf,
  liquidationRows,
  markRow,
  predictedFundingRow,
  settlementRowFromWs,
  VENUE,
} from './mappers';
import { OkxFundingRate, OkxLiquidation, OkxMarkPrice } from './payloads';

export const STREAM_LIQUIDATION = 'okx:liquidation-orders';
export const STREAM_MARK = 'okx:mark-price';
export const STREAM_FUNDING = 'okx:funding-rate';

/**
 * IB-009 — the OKX write policy, as a pure state machine. No I/O, no clock: the caller feeds it
 * events and calls `sampleMinute(boundary)`; everything it wants written comes back in `drain()`.
 * Same shape as IB-005's `MarkSampler`, and for the same reason — it makes every rule below a
 * spec rather than a timing test.
 *
 * The rules (§3.3, §4.3):
 *
 * - **mark is sampled per minute for the signal set only.** `mark-price` ticks continuously for
 *   every instrument; storing all of it is the row explosion D5 exists to avoid. For the rest of
 *   the universe only settlement rows are kept.
 * - **funding settlement rows are written for every symbol**, signal set or not: that is the
 *   number the venue actually charged, one row per 8 h, and it is cheap.
 * - `mark-price` and `funding-rate` are **separate channels**, so a stored row merges the latest
 *   of each. A minute that saw only one of them writes what it has and leaves the other null —
 *   never a stale value carried forward as if it were fresh, and never a zero.
 */
export interface OkxCollectorOptions {
  /** The universe's `okx_swap` ids — everything else on the shared liquidation channel is dropped. */
  instIds: readonly string[];
  /** The `okx_swap` ids of the signal set, whose mark is sampled every minute. */
  signalSetInstIds: readonly string[];
  contractSpecs: ReadonlyMap<string, ContractSpec>;
  onSkipped?: (instId: string, reason: string) => void;
}

interface Pending {
  mark?: OkxMarkPrice;
  funding?: OkxFundingRate;
  /** The `fundingTime` last seen, to notice a rollover. */
  fundingTime?: number;
}

export interface OkxDrain {
  markFunding: MarkFundingRow[];
  liquidations: LiquidationRow[];
  settlements: FundingSettlementRow[];
}

export class OkxCollector {
  private readonly universe: Set<string>;
  private readonly signalSet: Set<string>;
  private readonly pending = new Map<string, Pending>();
  private out: OkxDrain = { markFunding: [], liquidations: [], settlements: [] };

  constructor(private readonly options: OkxCollectorOptions) {
    this.universe = new Set(options.instIds);
    this.signalSet = new Set(options.signalSetInstIds);
  }

  /** True for an instrument this collector stores anything for. */
  tracks(instId: string): boolean {
    return this.universe.has(instId);
  }

  acceptMarkPrice(event: OkxMarkPrice): void {
    if (!this.tracks(event.instId)) return;
    const pending = this.pending.get(event.instId) ?? {};
    pending.mark = event;
    this.pending.set(event.instId, pending);
  }

  /**
   * A `funding-rate` event. Two things can come out of it: the settled rate for the interval that
   * just closed (written for every symbol), and the current prediction (merged into the next
   * per-minute mark row, signal set only).
   */
  acceptFundingRate(event: OkxFundingRate): void {
    if (!this.tracks(event.instId)) return;
    const pending = this.pending.get(event.instId) ?? {};
    const settlement = settlementRowFromWs(event);
    if (settlement !== null) this.out.settlements.push(settlement);

    const fundingTime = fundingTimeOf(event).getTime();
    if (pending.fundingTime !== undefined && fundingTime > pending.fundingTime && pending.funding !== undefined) {
      // The interval rolled over: keep the last prediction before it, stamped at the settlement
      // second, so the number the venue charged on is not lost between two minute samples (§4.1's
      // rule, applied to OKX).
      const last = predictedFundingRow(pending.funding);
      this.out.markFunding.push({ ...last, ts: new Date(pending.fundingTime) });
    }
    pending.funding = event;
    pending.fundingTime = fundingTime;
    this.pending.set(event.instId, pending);
  }

  acceptLiquidation(message: OkxLiquidation): void {
    if (!this.tracks(message.instId)) return;
    this.out.liquidations.push(
      ...liquidationRows(message, this.options.contractSpecs, this.options.onSkipped),
    );
  }

  /**
   * Called on each minute boundary: emits one `mark_funding_1m` row per signal-set instrument
   * that produced something this minute, stamped at the boundary (D5's "last sample in the
   * minute"). Instruments outside the signal set are not sampled — their settlement rows are
   * written as they arrive.
   */
  sampleMinute(boundary: Date): void {
    for (const instId of this.signalSet) {
      const pending = this.pending.get(instId);
      if (pending === undefined || (pending.mark === undefined && pending.funding === undefined)) continue;

      const mark = pending.mark !== undefined ? markRow(pending.mark) : null;
      const funding = pending.funding !== undefined ? predictedFundingRow(pending.funding) : null;
      this.out.markFunding.push({
        venue: VENUE,
        symbol: instId,
        ts: boundary,
        markPrice: mark?.markPrice ?? null,
        indexPrice: null, // the channel carries none (payloads.ts)
        predictedFundingRate: funding?.predictedFundingRate ?? null,
        nextFundingTime: funding?.nextFundingTime ?? null,
        source: 'ws',
      });
      // Only the mark is cleared: it ticks every second, so "nothing new this minute" is real
      // information. `funding-rate` ticks rarely, and its prediction stays valid until replaced.
      pending.mark = undefined;
    }
  }

  /** Takes everything accumulated so far and resets the buffer. */
  drain(): OkxDrain {
    const out = this.out;
    this.out = { markFunding: [], liquidations: [], settlements: [] };
    return out;
  }
}

export interface OkxDrainWriters {
  markFunding: { write(rows: readonly MarkFundingRow[]): Promise<number> };
  liquidations: { write(rows: readonly LiquidationRow[]): Promise<number> };
  fundingSettlements: { write(rows: readonly FundingSettlementRow[]): Promise<number> };
}

/**
 * IB-BUG-015 — writes one drain, each table on its own, liquidations FIRST (the priority data,
 * owner ruling 2026-10-31). A refused table is returned, not thrown, so the other two still land;
 * the caller logs each failure with its table and row count.
 */
export function writeOkxDrain(drained: OkxDrain, writers: OkxDrainWriters): Promise<WriteFailure[]> {
  return writeIsolated([
    step('liquidations', drained.liquidations, (rows) => writers.liquidations.write(rows)),
    step('mark_funding_1m', drained.markFunding, (rows) => writers.markFunding.write(rows)),
    step('funding_settlements', drained.settlements, (rows) => writers.fundingSettlements.write(rows)),
  ]);
}
