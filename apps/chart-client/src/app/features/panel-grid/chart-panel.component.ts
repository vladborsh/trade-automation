import { ChangeDetectionStrategy, Component, type Signal, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import type { Candle, IndicatorPoint, MetricPoint, OverlayPrimitive, Panel, Timeframe } from '@trade-automation/contracts';
import { ChartComponent } from '../chart/chart.component';
import { ChartSyncService } from '../chart/chart-sync.service';
import type { PositionToolChange } from '../chart/overlay/position-tool.model';
import { ResearchBadgeComponent } from '../research-badge/research-badge.component';
import { InstrumentsStore } from '../../core/state/instruments.store';
import { TimeframeStore } from '../../core/state/timeframe.store';
import { LayoutsStore } from '../../core/state/layouts.store';
import { CollapsedPanelsStore } from '../../core/state/collapsed-panels.store';
import { metricSeriesCaption, metricSeriesStyle } from '../chart/metric-series-style';
import { panelTitle, plottedMetricUnit } from './panel-title';
import type { PanelSource } from './panel-source';

const NO_WHITESPACE: readonly number[] = [];

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
  /** The panel's timeframe when it is not the live terminal's shared one (a replay session's). */
  readonly timeframe = input<Timeframe | null>(null);
  readonly tf = computed(() => this.timeframe() ?? this.timeframes.selected());

  // `<app-chart>`'s inputs are typed as mutable arrays and ChartComponent stays untouched (D2);
  // it never mutates them (its sorts work on copies), so the source's readonly arrays pass as-is.
  readonly candles = computed(() => this.source().candles() as Candle[]);
  readonly points = computed(() => this.source().points() as MetricPoint[]);
  readonly overlays = computed(() => this.source().overlays() as OverlayPrimitive[]);
  readonly indicatorPoints = computed(() => this.source().indicatorPoints() as IndicatorPoint[]);
  /** T-056: a replay panel's padded buckets; none on live panels. */
  readonly whitespace = computed(() => this.source().whitespace?.() ?? NO_WHITESPACE);
  /** §9.1 position tools, when the source has them (the replay workspace). */
  readonly positionTools = computed(() => this.source().positionTools?.view() ?? null);
  /** e2e hooks (the tools are drawn on a canvas): each tool, and the price under the pointer. */
  readonly toolsHook = computed(() =>
    this.positionTools()?.tools.map((t) => `${t.id}:${t.side}:${t.mode}:${t.entry}:${t.sl}:${t.tp}:${t.active ? 'active' : ''}`).join(' '),
  );
  readonly pointerPriceHook = signal<number | null>(null);
  /** The chart's crosshair and picture (a template ref, so a spec's stub chart satisfies it too). */
  private readonly chart = viewChild<{ crosshairPrice: Signal<number | null>; crosshairTime?: Signal<number | null>; takeScreenshot?(): HTMLCanvasElement | null }>('chart');
  private readonly sync = inject(ChartSyncService, { optional: true });
  /** The newest bar, as e2e hooks on the panel body (the chart itself is a canvas). */
  readonly lastBar = computed(() => this.candles().at(-1) ?? null);

  readonly title = computed(() =>
    panelTitle(this.panel(), this.instruments.selected(), plottedMetricUnit(this.points())),
  );
  /** §11.2 rule 4 — the style `<app-chart>` draws the metric in; exposed as an e2e hook (canvas has no DOM). */
  readonly metricStyle = computed(() => (this.panel().kind === 'metric' ? metricSeriesStyle(this.tf()) : null));
  /** §11.2 rule 5 — why the metric panel is a line (1m) or wickless candles (5m); none elsewhere. */
  readonly caption = computed(() =>
    this.panel().kind === 'metric' ? metricSeriesCaption(this.tf()) : null,
  );
  /** T-060: the header dot, only for a source with a live connection (never on replay panels). */
  readonly venueStatus = computed(() => this.source().venueStatus?.() ?? null);
  /** §11.3: the last expanded panel's collapse button is disabled. */
  readonly canCollapse = computed(() => {
    const layout = this.layouts.active();
    return layout ? this.collapsed.canCollapse(layout, this.panel().id) : false;
  });

  constructor(
    private readonly timeframes: TimeframeStore,
    private readonly instruments: InstrumentsStore,
    private readonly layouts: LayoutsStore,
    private readonly collapsed: CollapsedPanelsStore,
  ) {
    // The pointer's price goes to the position tools only while THIS panel drives the shared
    // crosshair: followers also show a crosshair price (the synced bar's close), which is not
    // where the user is pointing.
    // Sources without tools (the live terminal) return before reading anything, so their panels
    // track nothing here.
    effect(() => {
      const tools = this.source().positionTools;
      if (!tools) return;
      const driving = this.sync?.crosshair()?.origin === this.panel().id;
      const price = driving ? (this.chart()?.crosshairPrice() ?? null) : null;
      const timeSec = driving ? (this.chart()?.crosshairTime?.() ?? null) : null;
      tools.setPointerPrice(price, timeSec === null ? null : timeSec * 1000); // T-050: a draft anchors at that bar
      this.pointerPriceHook.set(price);
    });
    // §9.2 (T-026): the source takes this panel's picture through the chart, while it exists.
    effect((onCleanup) => {
      const capture = this.source().capture;
      if (!capture) return;
      capture.attach(() => this.chart()?.takeScreenshot?.() ?? null);
      onCleanup(() => capture.attach(null));
    });
  }

  onPositionToolChange(change: PositionToolChange): void {
    this.source().positionTools?.apply(change);
  }

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
