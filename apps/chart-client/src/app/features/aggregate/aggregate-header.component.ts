import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AggregateMetricPoint, MetricAggregate } from '@trade-automation/contracts';
import { conventionBadge, coverageChip } from './coverage-text';

/**
 * architecture/aggregate-oi.md §1 points 3–4 — the aggregate OI panel's header extras: the
 * counting-convention badge (next to the unit) and the coverage chip for the bar being read
 * (crosshair, else the last bar). Muted on a partial bar; the missing venues are named.
 */
@Component({
  selector: 'app-aggregate-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './aggregate-header.component.html',
  styleUrl: './aggregate-header.component.scss',
})
export class AggregateHeaderComponent {
  readonly aggregate = input<MetricAggregate | null>(null);
  readonly point = input<AggregateMetricPoint | null>(null);

  readonly badge = computed(() => {
    const aggregate = this.aggregate();
    return aggregate ? conventionBadge(aggregate.countingConvention) : null;
  });

  readonly chip = computed(() => {
    const point = this.point();
    return point ? coverageChip(point, this.aggregate()?.members.map((m) => m.id) ?? []) : null;
  });
}
