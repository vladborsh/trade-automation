import { ContractSpec } from '../../venues/okx/contract-size';
import { LiquidationRow } from '../writers/tables';
import { step, writeIsolated, WriteFailure } from '../writers/write-isolated';
import { liquidationRows } from './mappers';
import { OkxLiquidation } from './payloads';

export const STREAM_LIQUIDATION = 'okx:liquidation-orders';

/**
 * IB-009, slimmed by WD-010 — the OKX liquidation buffer, as a pure state machine (no I/O, no
 * clock): the caller feeds it `liquidation-orders` messages and writes what `drain()` returns.
 *
 * The mark-price / funding-rate side went with the funding tape (storage ruling S1: funding is read
 * from the venue on demand, WD-009). One instrument's `mark-price` is still SUBSCRIBED by the
 * service, as the socket's liveness signal only — it never reaches this class.
 */
export interface OkxCollectorOptions {
  /** The universe's `okx_swap` ids — everything else on the shared liquidation channel is dropped. */
  instIds: readonly string[];
  contractSpecs: ReadonlyMap<string, ContractSpec>;
  onSkipped?: (instId: string, reason: string) => void;
}

export interface OkxDrain {
  liquidations: LiquidationRow[];
}

export class OkxCollector {
  private universe: Set<string>;
  private out: OkxDrain = { liquidations: [] };

  constructor(private readonly options: OkxCollectorOptions) {
    this.universe = new Set(options.instIds);
  }

  /** IB-122 (L5): the tracked set changed (universe ∪ enabled alert coins); the shared channel is filtered to it. */
  setInstIds(instIds: readonly string[]): { added: string[]; removed: string[] } {
    const next = new Set(instIds);
    const added = [...next].filter((id) => !this.universe.has(id));
    const removed = [...this.universe].filter((id) => !next.has(id));
    this.universe = next;
    return { added, removed };
  }

  /** True for an instrument this collector stores liquidations for. */
  tracks(instId: string): boolean {
    return this.universe.has(instId);
  }

  acceptLiquidation(message: OkxLiquidation): void {
    if (!this.tracks(message.instId)) return;
    this.out.liquidations.push(
      ...liquidationRows(message, this.options.contractSpecs, this.options.onSkipped),
    );
  }

  /** Takes everything accumulated so far and resets the buffer. */
  drain(): OkxDrain {
    const out = this.out;
    this.out = { liquidations: [] };
    return out;
  }
}

export interface OkxDrainWriters {
  liquidations: { write(rows: readonly LiquidationRow[]): Promise<number> };
}

/**
 * IB-BUG-015 — writes one drain; a refused table is RETURNED (with its name and row count), not
 * thrown, so the service logs it and the next tick still runs. Since WD-010 liquidations are the
 * only table, so no other writer exists to block them — the isolation is kept so that adding one
 * back cannot quietly reintroduce the "markFunding failed, liquidations skipped" bug.
 */
export function writeOkxDrain(drained: OkxDrain, writers: OkxDrainWriters): Promise<WriteFailure[]> {
  return writeIsolated([
    step('liquidations', drained.liquidations, (rows) => writers.liquidations.write(rows)),
  ]);
}
