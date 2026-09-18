import type { AggregateMetricPoint, MetricPoint } from '@trade-automation/contracts';

/**
 * What a metric panel plots: a single-venue `MetricPoint` (chart-layouts §11.2) or, for a panel
 * with `aggregate`, an `AggregateMetricPoint` (architecture/aggregate-oi.md §1). Both share the
 * bucket identity (`time`) and the notional side the panel draws, so one store/renderer serves both.
 */
export type PanelMetricPoint = MetricPoint | AggregateMetricPoint;

export function isAggregatePoint(point: PanelMetricPoint): point is AggregateMetricPoint {
  return 'coverage' in point;
}
