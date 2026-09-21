import { Candle, Coverage, InstrumentId, Timeframe } from '@trade-automation/contracts';

/** architecture/live-signal-server.md §4.3. */
export interface CandleStore {
  /** Idempotent on (instrument, timeframe, openTime); closed bars only. */
  upsert(candles: Candle[]): Promise<void>;
  /** Ascending. */
  query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Promise<Candle[]>;
  latestOpenTime(instrument: InstrumentId, tf: Timeframe): Promise<number | null>;
  /** Ordered replay — "unpack into a stream of candles" (§6.3). */
  stream(instrument: InstrumentId, tf: Timeframe, from: number, to?: number): AsyncIterable<Candle>;
  /**
   * backtest-app-system-design.md §2.2 — earliest and latest `openTime` held for
   * (instrument, tf), or null when nothing is stored. Must stay cheap: a listing of the
   * day objects plus reads of the first and last non-empty day only, never the tape.
   * Says nothing about gaps in between.
   */
  coverage(instrument: InstrumentId, tf: Timeframe): Promise<Coverage | null>;
}

export const CANDLE_STORE = Symbol('CANDLE_STORE');
