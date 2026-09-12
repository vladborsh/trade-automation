import {
  Candle,
  IndicatorPoint,
  Instrument,
  Signal,
  StrategyRequirements,
  StrategyTier,
  Timeframe,
} from '@trade-automation/contracts';
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

/** architecture/live-signal-server.md §11.3 — a strategy's per-bar output. The runner fills in
 * the remaining IndicatorPoint fields (strategyId, instrument, timeframe, tier) on each point. */
export interface StrategyOutput {
  signals: Signal[];
  indicators?: Array<Pick<IndicatorPoint, 'seriesId' | 'time' | 'values'>>;
}

export interface SignalStrategy {
  readonly id: string;
  /** architecture/live-signal-server.md §11.1 — declared in code, never in strategies.yaml. */
  readonly tier: StrategyTier;
  readonly displayName: string;
  readonly description: string;
  readonly requirements: StrategyRequirements;
  /** Pure: no I/O, no timers, deterministic given ctx. */
  onCandle(ctx: StrategyContext): StrategyOutput;
}

/** Multi-provider token every SignalStrategy plug-in registers under. */
export const SIGNAL_STRATEGIES = Symbol('SIGNAL_STRATEGIES');
