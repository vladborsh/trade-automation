import { IndicatorPoint, Signal } from '@trade-automation/contracts';

export const StrategyEngineEvents = {
  SignalEmitted: 'strategy-engine.signal.emitted',
  IndicatorEmitted: 'strategy-engine.indicator.emitted',
} as const;

export class SignalEmittedEvent {
  constructor(public readonly signal: Signal) {}
}

export class IndicatorEmittedEvent {
  constructor(public readonly point: IndicatorPoint) {}
}
