import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  CandlestickSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
} from 'lightweight-charts';
import { createChart } from 'lightweight-charts';
import type { Candle, OverlayPrimitive } from '../../core/contracts/contracts';
import { toCandlestickData, toCandlestickSeries } from './chart-data.adapter';
import { OverlayLayer } from './overlay/overlay-layer';
import { MarkerRenderer } from './overlay/marker.renderer';
import { PriceLineRenderer } from './overlay/price-line.renderer';
import { RectRenderer } from './overlay/rect.renderer';
import { RayRenderer } from './overlay/ray.renderer';
import { LineRenderer } from './overlay/line.renderer';

const NEAR_START_LOGICAL_INDEX = 10;

/**
 * Owns the lightweight-charts instance (§5.2). Pure presentational
 * component: candles/overlays come in as inputs, pagination requests go out
 * as an output — no store/API knowledge here.
 */
@Component({
  selector: 'app-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // data-marker-count is a test hook (e2e asserts on it) — lightweight-charts
  // draws markers to canvas, so there is nothing else in the DOM to assert on.
  template: `<div class="chart-container" #container [attr.data-marker-count]="markerCount()"></div>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .chart-container {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  readonly candles = input.required<Candle[]>();
  readonly overlays = input<OverlayPrimitive[]>([]);
  readonly loadOlderRequested = output<void>();

  readonly markerCount = computed(() => this.overlays().filter((o) => o.type === 'marker').length);

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private readonly overlayLayer = new OverlayLayer();
  private lastRenderedCount = 0;
  private lastRenderedOpenTime: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.overlayLayer.register(new MarkerRenderer());
    this.overlayLayer.register(new PriceLineRenderer());
    this.overlayLayer.register(new RectRenderer());
    this.overlayLayer.register(new RayRenderer());
    this.overlayLayer.register(new LineRenderer());

    effect(() => {
      const candles = this.candles();
      this.renderCandles(candles);
    });

    effect(() => {
      const overlays = this.overlays();
      this.overlayLayer.render(overlays);
    });
  }

  ngAfterViewInit(): void {
    const el = this.container().nativeElement;
    this.chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#c9d1d9',
        fontFamily: "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      },
      grid: {
        vertLines: { color: '#161b22' },
        horzLines: { color: '#161b22' },
      },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    this.series = this.chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    this.overlayLayer.attachAll(this.chart, this.series);

    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
      if (range && range.from <= NEAR_START_LOGICAL_INDEX) {
        this.loadOlderRequested.emit();
      }
    });

    // re-run pending effects now that chart/series exist
    this.renderCandles(this.candles());
    this.overlayLayer.render(this.overlays());
  }

  private renderCandles(candles: Candle[]): void {
    if (!this.series) {
      return;
    }
    if (candles.length === 0) {
      this.series.setData([]);
      this.lastRenderedCount = 0;
      this.lastRenderedOpenTime = null;
      return;
    }

    const isIncrementalAppendOrUpdate =
      this.lastRenderedCount > 0 &&
      (candles.length === this.lastRenderedCount || candles.length === this.lastRenderedCount + 1);

    if (isIncrementalAppendOrUpdate) {
      const last = candles[candles.length - 1];
      this.series.update(toCandlestickData(last));
    } else {
      this.series.setData(toCandlestickSeries(candles));
    }
    this.lastRenderedCount = candles.length;
    this.lastRenderedOpenTime = candles[candles.length - 1].openTime;
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.overlayLayer.clearAll();
    this.chart?.remove();
  }
}
