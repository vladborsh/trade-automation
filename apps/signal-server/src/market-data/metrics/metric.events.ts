import { MetricObservation } from '@trade-automation/contracts';

/** architecture/chart-layouts.md §4.4 — event names on @nestjs/event-emitter's in-process bus. */
export const MetricEvents = {
  MetricObserved: 'market-data.metric.observed',
} as const;

export class MetricObservedEvent {
  constructor(public readonly observation: MetricObservation) {}
}
