import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CandlestickSeries,
  ColorType,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from 'lightweight-charts';
import { createChart } from 'lightweight-charts';
import type {
  Candle,
  IndicatorPoint,
  IndicatorSeriesSpec,
  MetricPoint,
  OverlayPrimitive,
  Timeframe,
} from '@trade-automation/contracts';
import { TIMEFRAME_MS } from '@trade-automation/contracts';
import { toCandlestickData, toCandlestickSeries, toLineData, toLineSeries } from './chart-data.adapter';
import { OverlayLayer } from './overlay/overlay-layer';
import { MarkerRenderer } from './overlay/marker.renderer';
import { PriceLineRenderer } from './overlay/price-line.renderer';
import { RectRenderer } from './overlay/rect.renderer';
import { RayRenderer } from './overlay/ray.renderer';
import { LineRenderer } from './overlay/line.renderer';
import { ShapesPrimitive } from './overlay/shapes.primitive';
import { IndicatorLayer } from './indicator/indicator-layer';
import { ChartSyncService, sameRange, type TimeRange } from './chart-sync.service';

const NEAR_START_LOGICAL_INDEX = 10;

/**
 * Owns the lightweight-charts instance (§5.2, extended by §6.6). Pure
 * presentational component: candles/points/overlays come in as inputs,
 * pagination requests go out as an output — no store/API knowledge here.
 *
 * `kind` picks the series type: `'candles'` draws a candlestick series and
 * attaches `OverlayLayer` (signal markers etc.); `'metric'` draws a single
 * `LineSeries` and never attaches overlays — a metric panel's `signals`
 * flag is schema-locked to `false` (libs/contracts `layout.ts`), so it
 * would receive nothing anyway, but §6.6 says explicitly: overlays are a
 * `'candles'`-only concept.
 */
@Component({
  selector: 'app-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // data-marker-count / data-indicator-series-count / data-visible-from
  // / data-visible-to are test hooks (e2e asserts on them) — lightweight-charts
  // draws to canvas, so there is nothing else in the DOM to assert on.
  template: `<div
    class="chart-container"
    #container
    [attr.data-marker-count]="markerCount()"
    [attr.data-indicator-series-count]="indicatorSeriesCount()"
    [attr.data-visible-from]="visibleFrom()"
    [attr.data-visible-to]="visibleTo()"
  ></div>`,
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
  readonly kind = input.required<'candles' | 'metric'>();
  readonly candles = input<Candle[]>([]);
  readonly points = input<MetricPoint[]>([]);
  readonly overlays = input<OverlayPrimitive[]>([]);
  readonly indicatorPoints = input<IndicatorPoint[]>([]);
  readonly indicatorSpecs = input<ReadonlyMap<string, IndicatorSeriesSpec>>(new Map());
  readonly timeframe = input.required<Timeframe>();
  readonly panelId = input.required<string>();
  readonly loadOlderRequested = output<void>();

  readonly markerCount = computed(() => this.overlays().filter((o) => o.type === 'marker').length);
  readonly indicatorSeriesCount = signal(0);
  readonly visibleFrom = signal<number | null>(null);
  readonly visibleTo = signal<number | null>(null);

  private readonly sync = inject(ChartSyncService);

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  private readonly overlayLayer = new OverlayLayer();
  private readonly shapesPrimitive = new ShapesPrimitive();
  private readonly indicatorLayer = new IndicatorLayer();
  private lastRenderedCount = 0;
  private lastRenderedTime: number | null = null; // candle openTime or metric point time, seconds-scale source (ms)

  /** Reentrancy guard 1 (§6.4): suppresses the range-change callback fired synchronously by our own setVisibleRange(). */
  private applying = false;
  /** Reentrancy guard 2 (§6.4): suppresses an async echo and a follower's own bar-grid "snap" of the applied range. */
  private lastApplied: TimeRange | null = null;

  constructor() {
    this.overlayLayer.register(new MarkerRenderer());
    this.overlayLayer.register(new PriceLineRenderer());
    this.overlayLayer.register(new RectRenderer(this.shapesPrimitive));
    this.overlayLayer.register(new RayRenderer(this.shapesPrimitive));
    this.overlayLayer.register(new LineRenderer(this.shapesPrimitive));

    effect(() => {
      if (this.kind() === 'candles') {
        this.renderCandles(this.candles());
      } else {
        this.renderPoints(this.points());
      }
    });

    effect(() => {
      if (this.kind() !== 'candles') {
        return;
      }
      const overlays = this.overlays();
      this.overlayLayer.render(overlays);
    });

    effect(() => {
      const points = this.indicatorPoints();
      const specs = this.indicatorSpecs();
      const tf = this.timeframe();
      this.indicatorLayer.render(points, specs, tf);
      this.indicatorSeriesCount.set(this.indicatorLayer.visibleSeriesCount());
    });

    // Follow (§6.4 step 2): apply a range proposed by another panel in this grid.
    effect(() => {
      const range = this.sync.range();
      if (!range || this.sync.origin() === this.panelId() || !this.chart || this.lastRenderedCount === 0) {
        // No data on this panel's series yet: lightweight-charts cannot map a
        // time range to a logical range with nothing to map it against, and
        // throws. Once this panel's own history lands, `renderCandles`/
        // `renderPoints` fires its own range-change event that re-seeds
        // things, so skipping here loses nothing.
        return;
      }
      this.applying = true;
      try {
        this.chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
        this.lastApplied = range;
      } catch {
        // lightweight-charts can still reject a range outside this panel's
        // data domain (e.g. a market-hours instrument during a synced
        // window it has no bars for) — never let one panel's chart crash
        // the shared sync effect for the rest of the grid.
      } finally {
        this.applying = false;
      }
    });
  }

  ngAfterViewInit(): void {
    const el = this.container().nativeElement;
    const isCandles = this.kind() === 'candles';
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

    this.series = isCandles
      ? this.chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        })
      : this.chart.addSeries(LineSeries, {
          color: '#58a6ff',
          lineWidth: 2,
          lastValueVisible: true,
          priceFormat: { type: 'volume' },
        });

    if (isCandles) {
      this.overlayLayer.attachAll(this.chart, this.series);
    }
    this.indicatorLayer.attach(this.chart);

    this.chart.timeScale().subscribeVisibleLogicalRangeChange((range: LogicalRange | null) => {
      if (range && range.from <= NEAR_START_LOGICAL_INDEX) {
        this.loadOlderRequested.emit();
      }
    });

    // Drive (§6.4 step 1): a USER-driven (or library-initiated, e.g. autofit on
    // first data) range change proposes the new shared range, unless it is
    // this component's own programmatic setVisibleRange() echoing back.
    this.chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) {
        this.visibleFrom.set(null);
        this.visibleTo.set(null);
        return;
      }
      this.visibleFrom.set(range.from as number);
      this.visibleTo.set(range.to as number);

      if (this.applying) {
        return;
      }
      const eps = this.syncEpsilonSec();
      const proposed: TimeRange = { from: range.from as number, to: range.to as number };
      if (sameRange(proposed, this.lastApplied, eps)) {
        return;
      }
      this.sync.propose(this.panelId(), proposed, eps);
    });

    // re-run pending effects now that chart/series exist
    if (isCandles) {
      this.renderCandles(this.candles());
      this.overlayLayer.render(this.overlays());
    } else {
      this.renderPoints(this.points());
    }
    this.indicatorLayer.render(this.indicatorPoints(), this.indicatorSpecs(), this.timeframe());
    this.indicatorSeriesCount.set(this.indicatorLayer.visibleSeriesCount());
  }

  /** Half a bar of the current timeframe, in seconds — larger than any bar-grid snap (§6.4). */
  private syncEpsilonSec(): number {
    return TIMEFRAME_MS[this.timeframe()] / 1000 / 2;
  }

  /** Captures the visible range before a full `setData()`, restores it after, under the `applying` guard. */
  private withPreservedRangeOnPrepend(isPrepend: boolean, setData: () => void): void {
    let preserved: TimeRange | null = null;
    if (isPrepend && this.chart) {
      const r = this.chart.timeScale().getVisibleRange();
      if (r) {
        preserved = { from: r.from as number, to: r.to as number };
      }
    }

    setData();

    if (preserved && this.chart) {
      this.applying = true;
      try {
        this.chart.timeScale().setVisibleRange({ from: preserved.from as UTCTimestamp, to: preserved.to as UTCTimestamp });
        this.lastApplied = preserved;
      } finally {
        this.applying = false;
      }
    }
  }

  private renderCandles(candles: Candle[]): void {
    if (!this.series || this.kind() !== 'candles') {
      return;
    }
    const series = this.series as ISeriesApi<'Candlestick'>;
    if (candles.length === 0) {
      series.setData([]);
      this.lastRenderedCount = 0;
      this.lastRenderedTime = null;
      return;
    }

    const isIncrementalAppendOrUpdate =
      this.lastRenderedCount > 0 &&
      (candles.length === this.lastRenderedCount || candles.length === this.lastRenderedCount + 1);
    // A prepend (scroll-back pagination) grows the series at the FRONT: the
    // tail (newest bar) is unchanged but the count jumped by more than one.
    const isPrepend =
      !isIncrementalAppendOrUpdate &&
      this.lastRenderedTime !== null &&
      candles.length > this.lastRenderedCount &&
      candles[candles.length - 1].openTime === this.lastRenderedTime;

    if (isIncrementalAppendOrUpdate) {
      const last = candles[candles.length - 1];
      series.update(toCandlestickData(last));
    } else {
      this.withPreservedRangeOnPrepend(isPrepend, () => series.setData(toCandlestickSeries(candles)));
    }
    this.lastRenderedCount = candles.length;
    this.lastRenderedTime = candles[candles.length - 1].openTime;
  }

  private renderPoints(points: MetricPoint[]): void {
    if (!this.series || this.kind() !== 'metric') {
      return;
    }
    const series = this.series as ISeriesApi<'Line'>;
    if (points.length === 0) {
      series.setData([]);
      this.lastRenderedCount = 0;
      this.lastRenderedTime = null;
      return;
    }

    const isIncrementalAppendOrUpdate =
      this.lastRenderedCount > 0 &&
      (points.length === this.lastRenderedCount || points.length === this.lastRenderedCount + 1);
    const isPrepend =
      !isIncrementalAppendOrUpdate &&
      this.lastRenderedTime !== null &&
      points.length > this.lastRenderedCount &&
      points[points.length - 1].time === this.lastRenderedTime;

    if (isIncrementalAppendOrUpdate) {
      const last = points[points.length - 1];
      series.update(toLineData(last));
    } else {
      this.withPreservedRangeOnPrepend(isPrepend, () => series.setData(toLineSeries(points)));
    }
    this.lastRenderedCount = points.length;
    this.lastRenderedTime = points[points.length - 1].time;
  }

  ngOnDestroy(): void {
    this.overlayLayer.clearAll();
    this.indicatorLayer.clearAll();
    this.chart?.remove();
  }
}
