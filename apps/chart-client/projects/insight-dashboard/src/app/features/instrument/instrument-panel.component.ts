import {
  ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, viewChild,
  type OnDestroy,
} from '@angular/core';
import { createChart, type IChartApi, type Time } from 'lightweight-charts';
import { I18nService } from '../../i18n/i18n.service';
import type { PaneData } from './pane-data';
import { createPanelRenderers, drawPanel, type PanelRenderers } from './panel-series';
import {
  PANEL_PRICE_SCALE, PANEL_TIME_SCALE, panelHeading, windowBounds, type PanelDef,
} from './panels.model';

/**
 * IB-BUG-009 — one panel of the instrument row: a title with its unit, an optional legend, and
 * one chart that **autoscales to its own visible data** (user feedback 2026-10-07).
 *
 * One chart per panel is the whole point of the change, and it costs the shared time scale that
 * IB-031 built the page around — see `panels.model.ts`, where that trade-off is written down.
 * What it buys, besides the layout the user asked for: each panel's price scale is its own, so
 * the zero-anchored liquidation bars can no longer drag the candles flat.
 *
 * **`:host { display: flex; flex: 1 1 0 }` in the stylesheet is load-bearing — do not drop it as
 * redundant.** An Angular component's host element is `display: inline` by default, so without
 * it the row's flex sizing lands on an inline box: the panel never stretches and **all six charts
 * collapse to about 60 px tall while every unit test passes.** That is how the first acceptance
 * run looked. With it they measure 260 × 710.
 */
@Component({
  selector: 'app-instrument-panel',
  standalone: true,
  templateUrl: './instrument-panel.component.html',
  styleUrl: './instrument-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstrumentPanelComponent implements OnDestroy {
  readonly panel = input.required<PanelDef>();
  readonly data = input<PaneData | null>(null);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('panelHost');
  private chart: IChartApi | null = null;
  private renderers: PanelRenderers = createPanelRenderers();

  private readonly i18n = inject(I18nService);
  readonly t = this.i18n.t.bind(this.i18n);
  /** The price panel's unit is the quote currency, so the heading needs the symbol. */
  readonly heading = (): string => panelHeading(this.t, this.panel(), this.data()?.instrument ?? '');

  constructor() {
    effect(() => {
      const data = this.data();
      if (!data) return;
      this.redraw(data);
    });
  }

  ngOnDestroy(): void {
    this.chart?.remove();
    this.chart = null;
  }

  private ensureChart(): IChartApi {
    if (this.chart) return this.chart;
    this.chart = createChart(this.host().nativeElement, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#30363d' }, horzLines: { color: '#30363d' } },
      // Autoscale, small symmetric margins, never zero-based or fixed (panels.model.ts).
      rightPriceScale: PANEL_PRICE_SCALE,
      // Each panel keeps its own time axis, as the brief requires. `minBarSpacing` is what lets
      // a 1440-bar day fit a 260 px column at all — see panels.model.ts.
      timeScale: PANEL_TIME_SCALE,
      autoSize: true,
    });
    return this.chart;
  }

  /**
   * Redraws from scratch: the page fetches a whole window at a time, so there is no incremental
   * path to get wrong. The chart is rebuilt rather than reused because a redraw adds series and
   * `addSeries` on every window would stack them (IB-031 kept one chart and relied on `setData`;
   * with six charts the cheaper and more obviously correct thing is a fresh chart per window).
   */
  private redraw(data: PaneData): void {
    this.chart?.remove();
    this.chart = null;
    this.renderers = createPanelRenderers();
    const chart = this.ensureChart();
    drawPanel(this.panel().key, chart, data, this.renderers);
    // Without this the panel shows whatever fits at the library's default bar spacing — about
    // 43 bars in a 260 px column — so the window's data arrives as a sliver. `windowBounds` is
    // the same range for all six, which is also what lines the row up.
    const bounds = windowBounds(data);
    if (bounds) {
      chart.timeScale().setVisibleRange({ from: bounds.from as Time, to: bounds.to as Time });
    }
  }
}
