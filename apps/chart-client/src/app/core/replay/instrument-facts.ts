import { computed, signal } from '@angular/core';
import type { BacktestInstrumentsResponse, ContractSpec, InstrumentId } from '@trade-automation/contracts';

/** An instrument's price decimals and venue contract, from `GET /backtest/instruments`. */
export interface InstrumentFact {
  pricePrecision: number;
  /** Null for an instrument without a contract block (it cannot be replayed; D12). */
  contract: ContractSpec | null;
}

export const DEFAULT_PRICE_PRECISION = 2;

/**
 * T-054 — the per-instrument facts the workspace needs besides candles: price precision (journal,
 * positions, tool labels) and the venue contract (sizing, margin, the unit a qty is in; design §6
 * D12). Filled once per session load; `pricePrecision` keeps the map shape the views already take.
 * Extracted from ReplaySessionStore.
 */
export class InstrumentFacts {
  private readonly facts = signal<ReadonlyMap<InstrumentId, InstrumentFact>>(new Map());

  /** Instrument → price decimals, for the views that take a precision map. */
  readonly pricePrecision = computed<ReadonlyMap<string, number>>(
    () => new Map([...this.facts()].map(([id, f]) => [id, f.pricePrecision])),
  );
  /** Instrument → the unit its qty counts ('BTC', 'contracts', 'EUR'), for the journal and positions. */
  readonly units = computed<ReadonlyMap<string, string>>(
    () => new Map([...this.facts()].flatMap(([id, f]) => (f.contract ? [[id, f.contract.unit] as const] : []))),
  );

  set(instruments: BacktestInstrumentsResponse): void {
    this.facts.set(new Map(instruments.map((i) => [i.id, { pricePrecision: i.pricePrecision, contract: i.contract ?? null }])));
  }

  precisionOf(id: InstrumentId | undefined): number {
    return (id === undefined ? undefined : this.facts().get(id)?.pricePrecision) ?? DEFAULT_PRICE_PRECISION;
  }

  contractOf(id: InstrumentId | undefined): ContractSpec | null {
    return (id === undefined ? undefined : this.facts().get(id)?.contract) ?? null;
  }
}
