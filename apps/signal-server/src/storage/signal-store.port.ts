import { InstrumentId, Signal } from '@trade-automation/contracts';

/** architecture/live-signal-server.md §4.3. */
export interface SignalStore {
  append(signals: Signal[]): Promise<void>;
  query(instrument: InstrumentId, from: number, to: number, strategyId?: string): Promise<Signal[]>;
}

export const SIGNAL_STORE = Symbol('SIGNAL_STORE');
