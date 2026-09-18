import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Panel } from '@trade-automation/contracts';
import { ChartComponent } from '../chart/chart.component';
import { ResearchBadgeComponent } from '../research-badge/research-badge.component';
import { ConnectionStore } from '../../core/state/connection.store';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { StrategiesStore } from '../../core/state/strategies.store';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { LayoutFeedService } from '../../core/state/layout-feed.service';
import { LayoutsStore } from '../../core/state/layouts.store';
import { CollapsedPanelsStore } from '../../core/state/collapsed-panels.store';
import type { PanelFeed } from '../../core/state/panel-feed';
import { signalsToOverlays } from '../chart/overlay/signal-to-overlays';
import { panelTitle } from './panel-title';

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

  readonly title = computed(() => {
    const points = this.feed().points.points();
    const unit = points.length > 0 ? points[points.length - 1].unit : null;
    return panelTitle(this.panel(), this.instruments.selected(), unit);
  });
  readonly venueStatus = computed(() => this.connection.statusFor(this.panel().instrument)?.venueStatus ?? 'down');
  readonly overlays = computed(() =>
    this.panel().kind === 'candles' ? signalsToOverlays(this.feed().signals.signals()) : [],
  );
  /** §11.3: the last expanded panel's collapse button is disabled. */
  readonly canCollapse = computed(() => {
    const layout = this.layouts.active();
    return layout ? this.collapsed.canCollapse(layout, this.panel().id) : false;
  });

  constructor(
    readonly strategies: StrategiesStore,
    readonly timeframe: TimeframeStore,
    private readonly connection: ConnectionStore,
    private readonly instruments: InstrumentsStore,
    private readonly layoutFeed: LayoutFeedService,
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
    void this.layoutFeed.loadOlder(this.panel().id);
  }
}
