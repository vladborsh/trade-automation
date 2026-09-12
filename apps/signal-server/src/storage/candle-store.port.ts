import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';

/** architecture/live-signal-server.md §4.3. */
export interface CandleStore {
  /** Idempotent on (instrument, timeframe, openTime); closed bars only. */
  upsert(candles: Candle[]): Promise<void>;
  /** Ascending. */
  query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Candle[]>;
  latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null>;
  /** Ordered replay — "unpack into a stream of candles" (§6.3). */
  stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle>;
}

export const CANDLE_STORE = Symbol('CANDLE_STORE');
