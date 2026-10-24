import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked,
  viewChild, type OnDestroy,
} from '@angular/core';
import { createChart, type IChartApi, type Time } from 'lightweight-charts';
import { I18nService } from '../../i18n/i18n.service';
import { liquidationScopeLabel } from './liquidation-scope';
import { createPanelRenderers, drawPanel, type PanelRenderers } from './panel-series';
import type { PaneData } from './pane-data';
import {
  DEFAULT_PANE_FRACTIONS, browserStore, fractionsDiffer, fractionsFromStretch, loadPaneFractions,
  savePaneFractions, type PaneFractions, type PaneKey,
} from './pane-heights';
import { legendEntries } from './pane-legend';
import {
  CHART_PANES_OPTIONS, PANELS, PANEL_PRICE_SCALE, PANEL_TIME_SCALE, panelHeading, windowBounds,
} from './panels.model';

export type { PaneData } from './pane-data';

/**
 * The instrument chart, 2026-10-24 redesign (architecture/insight-bot-web-dashboard.md §13).
 *
 * **One chart, five panes, one time axis.** This reverses IB-BUG-009's row of five independent
 * charts on the user's own choice of layout: price is the centre of the screen and the indicators
 * sit under it, so a moment is the same moment in every pane. That also retires the problem
 * IB-BUG-009 documented at length here (six time scales that could not be kept in sync): a shared
 * time scale is in sync by construction. What IB-BUG-009 bought is kept: each pane has its own
 * autoscaled price scale, so open interest cannot flatten the candles.
 *
 * **Pane heights are the reader's, and survive a reload.** The separators are the library's own
 * (`CHART_PANES_OPTIONS.enableResize`), and the library sizes panes by proportional *stretch
 * factors*, which a drag rewrites. So the stored shares go in with `setStretchFactor` (no pixels,
 * so it works before the chart is laid out) and come back out with `getStretchFactor` when a
 * pointer is released over the chart. There is no "pane resized" event to listen to instead.
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
  templateUrl: './instrument-chart.component.html',
  styleUrl: './instrument-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // On the document, not the chart: a separator dragged past the chart's edge is released outside it.
  host: { '(document:pointerup)': 'onPointerUp()' },
})
export class InstrumentChartComponent implements OnDestroy {
  readonly data = input<PaneData | null>(null);
  /** The bare symbol, `BTCUSDT`: the price and CVD units are read from it. */
  readonly symbol = input<string>('');

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('chartHost');
  private chart: IChartApi | null = null;
  private renderers: PanelRenderers = createPanelRenderers();
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private readonly store = browserStore();
  private fractions: PaneFractions = loadPaneFractions(this.store);

  /** Each pane's top edge in px from the chart's top, for its legend. */
  readonly tops = signal<readonly number[]>([]);

  readonly legends = computed(() => {
    const data = this.data();
    const tops = this.tops();
    return PANELS.map((panel, i) => ({
      key: panel.key,
      heading: panelHeading(this.t, panel, this.symbol()),
      entries: legendEntries(panel, data, this.t),
      top: tops[i] ?? null,
    }));
  });

  /** IB-039: built from the venues the DATA came from, never from the filter the page sent. */
  readonly scopeLabel = (venues: readonly string[], undercounted: boolean): string =>
    liquidationScopeLabel(this.t, venues, undercounted, null);

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data) return;
      untracked(() => this.redraw(data));
    });
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  /** Back to the default split, and remembered as such. */
  resetHeights(): void {
    this.fractions = { ...DEFAULT_PANE_FRACTIONS };
    savePaneFractions(this.store, this.fractions);
    this.applyShares();
    this.schedule();
  }

  /** A released pointer may have ended a separator drag: read the shares back. */
  onPointerUp(): void {
    this.schedule(true);
  }

  /** While a button is held over the chart, keep the legends on their panes. */
  onPointerMove(event: PointerEvent): void {
    if (event.buttons !== 0) this.schedule();
  }

  /**
   * Redraws from scratch: the page fetches a whole window at a time, so there is no incremental
   * path to get wrong, and a fresh chart cannot stack series from the previous window.
   */
  private redraw(data: PaneData): void {
    this.teardown();
    this.renderers = createPanelRenderers();
    const host = this.host().nativeElement;
    const chart = createChart(host, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9', panes: CHART_PANES_OPTIONS },
      grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
      rightPriceScale: PANEL_PRICE_SCALE,
      timeScale: PANEL_TIME_SCALE,
      // Sized here and by `sync`, not `autoSize`: see the class comment on ResizeObserver.
      width: host.clientWidth,
      height: host.clientHeight,
    });
    this.chart = chart;
    for (const panel of PANELS) drawPanel(panel.key, chart, data, this.renderers);
    for (const pane of chart.panes()) pane.priceScale('right').applyOptions(PANEL_PRICE_SCALE);
    this.applyShares();
    const bounds = windowBounds(data);
    if (bounds) chart.timeScale().setVisibleRange({ from: bounds.from as Time, to: bounds.to as Time });
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.host().nativeElement);
    this.schedule();
  }

  /** The remembered shares as the panes' stretch factors. */
  private applyShares(): void {
    const panes = this.chart?.panes() ?? [];
    if (panes.length !== PANELS.length) return;
    panes.forEach((pane, i) => pane.setStretchFactor(this.fractions[PANELS[i].key]));
  }

  /** On the next frame: place the legends and, after a possible drag, remember the shares. */
  private schedule(save = false): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.sync(save));
  }

  private sync(save: boolean): void {
    const chart = this.chart;
    if (!chart) return;
    const host = this.host().nativeElement;
    const size = chart.options();
    if (size.width !== host.clientWidth || size.height !== host.clientHeight) {
      chart.resize(host.clientWidth, host.clientHeight);
    }
    const panes = chart.panes();
    const hostTop = this.host().nativeElement.getBoundingClientRect().top;
    this.tops.set(panes.map((pane) => {
      const el = pane.getHTMLElement();
      return el ? Math.round(el.getBoundingClientRect().top - hostTop) : 0;
    }));
    if (!save || panes.length !== PANELS.length) return;
    const factors = {} as Record<PaneKey, number>;
    PANELS.forEach((panel, i) => { factors[panel.key] = panes[i].getStretchFactor(); });
    const shares = fractionsFromStretch(factors);
    if (shares && fractionsDiffer(shares, this.fractions)) {
      this.fractions = shares;
      savePaneFractions(this.store, shares);
    }
  }

  private teardown(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.observer = null;
    this.chart?.remove();
    this.chart = null;
  }
}
