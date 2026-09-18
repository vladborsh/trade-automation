import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Panel } from '@trade-automation/contracts';
import { ChartComponent } from '../chart/chart.component';
import { ResearchBadgeComponent } from '../research-badge/research-badge.component';
import { ConnectionStore } from '../../core/state/connection.store';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { StrategiesStore } from '../../core/state/strategies.store';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import type { PanelFeed } from '../../core/state/panel-feed';
import { signalsToOverlays } from '../chart/overlay/signal-to-overlays';
import { metricSeriesCaption, metricSeriesStyle } from '../chart/metric-series-style';
import { panelTitle, plottedMetricUnit } from './panel-title';

/**
 * architecture/chart-layouts.md §6.1 — one panel: header (title, venue
 * status dot) + `<app-chart>`, bound to this panel's own `PanelFeed`.
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
  readonly feed = input.required<PanelFeed>();

  readonly title = computed(() =>
    panelTitle(this.panel(), this.instruments.selected(), plottedMetricUnit(this.feed().points.points())),
  );
  /** §11.2 rule 4 — the style `<app-chart>` draws the metric in; exposed as an e2e hook (canvas has no DOM). */
  readonly metricStyle = computed(() => (this.panel().kind === 'metric' ? metricSeriesStyle(this.timeframe.selected()) : null));
  /** §11.2 rule 5 — why the metric panel is a line (1m) or wickless candles (5m); none elsewhere. */
  readonly caption = computed(() =>
    this.panel().kind === 'metric' ? metricSeriesCaption(this.timeframe.selected()) : null,
  );
  readonly venueStatus = computed(() => this.connection.statusFor(this.panel().instrument)?.venueStatus ?? 'down');
  readonly overlays = computed(() =>
    this.panel().kind === 'candles' ? signalsToOverlays(this.feed().signals.signals()) : [],
  );

  constructor(
    readonly strategies: StrategiesStore,
    readonly timeframe: TimeframeStore,
    private readonly connection: ConnectionStore,
    private readonly instruments: InstrumentsStore,
    private readonly layoutFeed: LayoutFeedService,
  ) {}

  onLoadOlder(): void {
    void this.layoutFeed.loadOlder(this.panel().id);
  }
}
