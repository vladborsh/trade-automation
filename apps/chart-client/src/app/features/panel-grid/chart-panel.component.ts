import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Candle, IndicatorPoint, MetricPoint, OverlayPrimitive, Panel } from '@trade-automation/contracts';
import { ChartComponent } from '../chart/chart.component';
import { ResearchBadgeComponent } from '../research-badge/research-badge.component';
import { ConnectionStore } from '../../core/state/connection.store';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { LayoutsStore } from '../../core/state/layouts.store';
import { CollapsedPanelsStore } from '../../core/state/collapsed-panels.store';
import { metricSeriesCaption, metricSeriesStyle } from '../chart/metric-series-style';
import { panelTitle, plottedMetricUnit } from './panel-title';
import type { PanelSource } from './panel-source';

/**
 * architecture/chart-layouts.md §6.1 — one panel: header (title, venue
 * status dot) + `<app-chart>`, bound to this panel's own `PanelSource`
 * (backtest-app-system-design.md §2.3, D2) — a live `PanelFeed` or a replay source.
 *
 * `<app-research-badge>` is the VWAP client unit's component (untouched —
 * see instruments.store.ts's doc comment): `PanelGridComponent` renders
 * this component through `NgComponentOutlet` with a per-panel injector that
 * overrides `InstrumentsStore`/`SignalsStore`/`IndicatorsStore` with this
 * panel's own scoped/owned instances, so the badge resolves per-panel data
 * via its normal constructor injection without any change to its code.
 */
@Component({
  selector: 'app-chart-panel',
  standalone: true,
  imports: [ChartComponent, ResearchBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chart-panel.component.html',
  styleUrl: './chart-panel.component.scss',
})
export class ChartPanelComponent {
  readonly panel = input.required<Panel>();
  readonly source = input.required<PanelSource>();

  // `<app-chart>`'s inputs are typed as mutable arrays and ChartComponent stays untouched (D2);
  // it never mutates them (its sorts work on copies), so the source's readonly arrays pass as-is.
  readonly candles = computed(() => this.source().candles() as Candle[]);
  readonly points = computed(() => this.source().points() as MetricPoint[]);
  readonly overlays = computed(() => this.source().overlays() as OverlayPrimitive[]);
  readonly indicatorPoints = computed(() => this.source().indicatorPoints() as IndicatorPoint[]);

  readonly title = computed(() =>
    panelTitle(this.panel(), this.instruments.selected(), plottedMetricUnit(this.points())),
  );
  /** §11.2 rule 4 — the style `<app-chart>` draws the metric in; exposed as an e2e hook (canvas has no DOM). */
  readonly metricStyle = computed(() => (this.panel().kind === 'metric' ? metricSeriesStyle(this.timeframe.selected()) : null));
  /** §11.2 rule 5 — why the metric panel is a line (1m) or wickless candles (5m); none elsewhere. */
  readonly caption = computed(() =>
    this.panel().kind === 'metric' ? metricSeriesCaption(this.timeframe.selected()) : null,
  );
  readonly venueStatus = computed(() => this.connection.statusFor(this.panel().instrument)?.venueStatus ?? 'down');
  /** §11.3: the last expanded panel's collapse button is disabled. */
  readonly canCollapse = computed(() => {
    const layout = this.layouts.active();
    return layout ? this.collapsed.canCollapse(layout, this.panel().id) : false;
  });

  constructor(
    readonly timeframe: TimeframeStore,
    private readonly connection: ConnectionStore,
    private readonly instruments: InstrumentsStore,
    private readonly layouts: LayoutsStore,
    private readonly collapsed: CollapsedPanelsStore,
  ) {}

  collapse(): void {
    const layout = this.layouts.active();
    if (layout) {
      this.collapsed.collapse(layout, this.panel().id);
    }
  }

  onLoadOlder(): void {
    void this.source().loadOlder();
  }
}
