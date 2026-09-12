import { Signal } from '@trade-automation/contracts';

export const StrategyEngineEvents = {
  SignalEmitted: 'strategy-engine.signal.emitted',
} as const;

export class SignalEmittedEvent {
  constructor(public readonly signal: Signal) {}
}
