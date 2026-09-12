import { Candle, Instrument, Signal, StrategyRequirements, Timeframe } from '@trade-automation/contracts';
import { ZonedTime } from './clock';

/** architecture/live-signal-server.md §4.4 — strategy-private, per-instrument state. */
export type StrategyState = Record<string, unknown>;

export interface StrategyContext {
  instrument: Instrument;
  now: number; // openTime of the bar that just closed
  window(tf: Timeframe): readonly Candle[]; // closed bars, ascending
  state: StrategyState;
  clock: { toZoned(ms: number, tz: string): ZonedTime };
}

export interface SignalStrategy {
  readonly id: string;
  readonly requirements: StrategyRequirements;
  /** Pure: no I/O, no timers, deterministic given ctx. */
  onCandle(ctx: StrategyContext): Signal[];
}

/** Multi-provider token every SignalStrategy plug-in registers under. */
export const SIGNAL_STRATEGIES = Symbol('SIGNAL_STRATEGIES');
