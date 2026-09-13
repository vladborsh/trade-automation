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
  template: `
    <div class="chart-panel" [attr.data-panel-id]="panel().id">
      <div class="panel-header">
        <span class="panel-title">{{ title() }}</span>
        <span class="venue-dot" [class]="'venue-' + venueStatus()"></span>
        <app-research-badge />
      </div>
      <div class="panel-body">
        <app-chart
          [panelId]="panel().id"
          [kind]="panel().kind"
          [candles]="feed().candles.candles()"
          [points]="feed().points.points()"
          [overlays]="overlays()"
          [indicatorPoints]="feed().indicators.points()"
          [indicatorSpecs]="strategies.indicatorSpecs()"
          [timeframe]="timeframe.selected()"
          (loadOlderRequested)="onLoadOlder()"
        />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
        min-height: 0;
        min-width: 0;
      }
      .chart-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-width: 0;
        border: 1px solid #30363d;
      }
      .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-bottom: 1px solid #30363d;
        font-size: 12px;
        color: #c9d1d9;
      }
      .panel-title {
        font-weight: 600;
      }
      .venue-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #787b86;
      }
      .venue-up {
        background: #26a69a;
      }
      .venue-degraded {
        background: #d29922;
      }
      .venue-down,
      .venue-closed {
        background: #ef5350;
      }
      .panel-body {
        flex: 1;
        min-height: 0;
        min-width: 0;
      }
    `,
  ],
})
export class ChartPanelComponent {
  readonly panel = input.required<Panel>();
  readonly feed = input.required<PanelFeed>();

  readonly title = computed(() => this.panel().title ?? this.instruments.selected()?.displayName ?? this.panel().instrument);
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
