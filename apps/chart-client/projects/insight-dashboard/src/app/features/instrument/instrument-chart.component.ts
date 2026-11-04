import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal,
  untracked, viewChild, type OnDestroy,
} from '@angular/core';
import { createChart, type IChartApi, type LogicalRange, type MouseEventParams } from 'lightweight-charts';
import { I18nService } from '../../i18n/i18n.service';
import { LoaderComponent } from '../../ui/loader.component';
import { CalendarTooltipComponent } from './calendar-tooltip.component';
import { markAt } from './calendar-marks';
import { liquidationScopeLabel } from './liquidation-scope';
import { createPanelRenderers, drawPanel, eventMarks, redrawPanels, type PanelRenderers } from './panel-series';
import type { PaneData } from './pane-data';
import { browserStore, loadPaneHeights, paneEdges, totalPaneHeight, type PaneHeights } from './pane-heights';
import { PaneDrag } from './pane-drag';
import { paneLegends } from './pane-legend';
import {
  PANELS, PANEL_PRICE_SCALE, instrumentChartOptions, showWholeWindow,
} from './panels.model';
import { TimeAxisStrip } from './time-axis-strip';
import { keepView } from './carried-view';
import { focusLabelKey, type FocusView } from './focus-at';
import { ChartOverlays } from './chart-overlays';
import { FocusMarker } from './focus-marker';
import { futureSlots } from './future-bars';

export type { PaneData } from './pane-data';

/**
 * The instrument chart, 2026-10-24 redesign (architecture/insight-bot-web-dashboard.md §13).
 *
 * **One chart, five panes, one time axis.** This reverses IB-BUG-009's row of five independent
 * charts on the user's own choice of layout: price is the centre of the screen and the indicators
 * sit under it, so a moment is the same moment in every pane. That also retires the problem
 * IB-BUG-009 documented at length here (six time scales that could not be kept in sync): a shared
 * time scale is in sync by construction. What IB-BUG-009 bought is kept: each pane has its own
 * autoscaled price scale, so open interest cannot flatten the candles. The price of one shared
 * scale is that every series must sit on the candle grid (time-grid.ts).
 *
 * **Pane heights are pixels, the reader's, and survive a reload.** Dragging a pane's lower edge
 * changes that pane alone and moves the panes under it down; the chart grows and the page
 * scrolls (user, 2026-10-24). The library's own separators cannot do that: they trade height
 * between the two neighbours inside a fixed chart. So they are off (`enableResize: false`) and
 * each pane has a handle of ours on its lower edge. The chart's height is the panes' sum plus
 * the separators and the time axis, and the panes' stretch factors ARE their pixel heights, so the
 * library gives each pane exactly its height.
 *
 * **The time axis is a sticky strip of its own** (`time-axis-strip.ts`): the library draws its
 * axis inside the canvas under the last pane, where tall panes push it off the screen. The main
 * chart's axis is hidden, so its height is the panes and separators only.
 *
 * **Scrolling to the left edge asks for earlier history** (`nearLeftEdge`); the page fetches it and
 * hands back the longer window marked `extendsPrevious`, and the redraw keeps the reader's view.
 *
 * **The chart is sized by this component, not by the library's `autoSize`.** With `autoSize`
 * the library builds a multi-pane chart's canvases lazily, inside its own ResizeObserver
 * callback, and those canvases install observers of their own mid-delivery. Chrome then reports
 * "ResizeObserver loop completed with undelivered notifications" on every redraw (traced
 * 2026-10-24; master's single-pane charts never showed it). Created at the container's measured
 * size, the chart builds its panes synchronously, and one observer on the container calls
 * `resize` from the next animation frame, outside any observer callback.
 *
 * Legends are HTML over each pane's top-left corner, because the library draws no pane titles.
 */
@Component({
  selector: 'app-instrument-chart',
  standalone: true,
  imports: [LoaderComponent, CalendarTooltipComponent],
  templateUrl: './instrument-chart.component.html',
  styleUrl: './instrument-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentChartComponent implements OnDestroy {
  readonly data = input<PaneData | null>(null);
  /** The bare symbol, `BTCUSDT`: the price and CVD units are read from it. */
  readonly symbol = input<string>('');
  /** A line for under the chart about the left edge: no earlier history exists. */
  readonly edgeNote = input<string | null>(null);
  /** An earlier window is loading after a scroll left: an inline loader in the foot. */
  readonly loadingEarlier = input(false);
  /** IB-098: open on this moment (from `?at=`) and mark it, when the data is the frame it chose. */
  readonly focus = input<FocusView | null>(null);
  /** The reader scrolled or zoomed out past the oldest bar drawn. */
  readonly nearLeftEdge = output<void>();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private readonly axisHost = viewChild.required<ElementRef<HTMLDivElement>>('axisHost');
  private axis: TimeAxisStrip | null = null;
  private overlays: ChartOverlays | null = null;
  private chart: IChartApi | null = null;
  private renderers: PanelRenderers = createPanelRenderers();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private readonly store = browserStore();

  readonly heights = signal<PaneHeights>(loadPaneHeights(this.store));
  /** Dragging a pane's lower edge, and «reset heights» (`pane-drag.ts`). */
  readonly drag = new PaneDrag(this.heights, this.store);

  /** Panes and the 1 px separators between them; the time axis is the sticky strip below. */
  readonly chartHeight = computed(() => totalPaneHeight(this.heights()) + (PANELS.length - 1));

  /** Each pane's edges in px from the chart's top: its legend at the top, its handle at the bottom. */
  readonly edges = computed(() => paneEdges(this.heights()));

  readonly legends = computed(() => paneLegends(this.t, this.data(), this.symbol(), this.edges()));

  /** IB-060: the bar under the crosshair, and the economic events on it for the tooltip. */
  readonly hover = signal<{ time: number; x: number } | null>(null);
  private readonly marks = computed(() => { const d = this.data(); return d ? eventMarks(d) : []; });
  /** IB-099: a calendar badge hovered or tapped — it wins over the crosshair until unpinned. */
  readonly badge = signal<{ time: number; x: number } | null>(null);
  readonly tipAt = computed(() => this.badge() ?? this.hover());
  readonly hoverMark = computed(() => markAt(this.marks(), this.tipAt()?.time ?? null));

  /** IB-039: built from the venues the DATA came from, never from the filter the page sent. */
  readonly scopeLabel = (venues: readonly string[], undercounted: boolean): string =>
    liquidationScopeLabel(this.t, venues, undercounted, null);

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data) return;
      untracked(() => this.redraw(data));
    });
    // A height change resizes the chart and re-proportions the panes; the host follows by binding.
    effect(() => {
      this.heights();
      this.chartHeight();
      untracked(() => {
        this.applyHeights();
        this.schedule();
      });
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  /**
   * Data that only extends what is on screen (left by scrolling, right by the live tail) is drawn
   * again on the same chart, which keeps the reader's zoom, and the scroll follows the new bar from
   * the right edge or stays put (`carried-view.ts`). Anything else is a fresh chart on the whole window.
   */
  private redraw(data: PaneData): void {
    const current = this.chart;
    if (current && (data.extendsPrevious || data.extendsLater)) {
      keepView(current, data, () => (this.renderers = redrawPanels(current, data, this.renderers, PANELS.map((p) => p.key))));
      this.overlays?.update(this.marks());
      return this.axis?.refresh(futureSlots(data));
    }
    this.teardown();
    this.renderers = createPanelRenderers();
    const host = this.host().nativeElement;
    // Sized here and by `sync`, not `autoSize`: see the class comment on ResizeObserver.
    const chart = createChart(host, instrumentChartOptions(host.clientWidth, this.chartHeight()));
    this.chart = chart;
    for (const panel of PANELS) drawPanel(panel.key, chart, data, this.renderers);
    for (const pane of chart.panes()) pane.priceScale('right').applyOptions(PANEL_PRICE_SCALE);
    this.applyHeights();
    const focus = this.focus()?.timeframe === data.timeframe ? this.focus() : null;
    if (focus) FocusMarker.open(chart, focus); else showWholeWindow(chart, data);
    this.overlays = new ChartOverlays(chart, host.parentElement as HTMLElement, {
      focus, focusLabel: this.t(focusLabelKey(focus)), marks: this.marks(), onBadge: (b) => this.badge.set(b),
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => this.onRange(range));
    chart.subscribeCrosshairMove((p: MouseEventParams) =>
      this.hover.set(p.time !== undefined && p.point ? { time: p.time as number, x: p.point.x } : null));
    this.axis = new TimeAxisStrip(this.axisHost().nativeElement, this.i18n.lang);
    this.axis.attach(chart, { background: '#0d1117', text: '#c9d1d9' }, data.timeframe, futureSlots(data));
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(host);
    this.schedule();
  }

  /**
   * Scrolled or zoomed out past the oldest bar drawn: ask for more. Past it, not near it: the
   * first view is the whole window, whose left edge IS the oldest bar, and asking then would
   * fetch history nobody scrolled to. The page ignores repeats while a read is in flight.
   */
  private onRange(range: LogicalRange | null): void {
    if (range && range.from < -1) this.nearLeftEdge.emit();
  }

  /** The pixel heights as the panes' stretch factors, which the library divides the chart by. */
  private applyHeights(): void {
    const panes = this.chart?.panes() ?? [];
    if (panes.length !== PANELS.length) return;
    const heights = this.heights();
    panes.forEach((pane, i) => pane.setStretchFactor(heights[PANELS[i].key]));
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.sync());
  }

  /** Width from the container, height from the panes; the strip follows both. */
  private sync(): void {
    const chart = this.chart;
    if (!chart) return;
    const width = this.host().nativeElement.clientWidth;
    const size = chart.options();
    if (size.width !== width || size.height !== this.chartHeight()) chart.resize(width, this.chartHeight());
    this.axis?.resize();
    this.overlays?.place();
  }

  private teardown(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.axis?.destroy();
    this.axis = null;
    this.overlays?.destroy();
    this.overlays = null;
    this.badge.set(null);
    this.chart?.remove();
    this.chart = null;
  }
}
