import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { KpiChartGeometry } from './kpi-chart';

/**
 * IB-118 (market round 2 §2) — a KPI tile's 7-day mini chart: an area line with dots on the min, the
 * max and the newest point (cap, BTC OI), bars around zero, one per settlement (BTC funding), or —
 * IB-131 — two stacked strips, BTC over ETH, each on its own scale (dominance). Draws
 * what `kpi-chart.ts` computed; the numbers under it («7д мин / макс») are the tile's.
 */
@Component({
  selector: 'app-kpi-chart',
  standalone: true,
  templateUrl: './kpi-chart.component.html',
  styleUrl: './kpi-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KpiChartComponent {
  readonly geometry = input.required<KpiChartGeometry>();
  /** The chart in words, for a screen reader (the min / max line the tile shows). */
  readonly label = input<string>('');
}
