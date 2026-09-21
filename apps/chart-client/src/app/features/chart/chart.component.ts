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
  untracked,
  viewChild,
} from '@angular/core';
import {
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
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
import { metricPlottedClose, toCandlestickData, toCandlestickSeries } from './chart-data.adapter';
import { CANDLE_SERIES_OPTIONS, CHART_OPTIONS } from './chart-options';
import { MetricSeriesRenderer } from './metric-series.renderer';
import { OverlayLayer } from './overlay/overlay-layer';
import { MarkerRenderer } from './overlay/marker.renderer';
import { PriceLineRenderer } from './overlay/price-line.renderer';
import { RectRenderer } from './overlay/rect.renderer';
import { RayRenderer } from './overlay/ray.renderer';
import { LineRenderer } from './overlay/line.renderer';
import { ShapesPrimitive } from './overlay/shapes.primitive';
import { PositionToolLayer } from './overlay/position-tool.layer';
import type { PositionToolChange, PositionToolsView } from './overlay/position-tool.model';
import { IndicatorLayer } from './indicator/indicator-layer';
import { ChartCrosshair } from './chart-crosshair';
import { ChartRangeSync } from './chart-range-sync';
import { ChartSyncService } from './chart-sync.service';
import { ResizeSettleTracker, observeResize } from './resize-settle';
import { isNearOldestLoaded, logicalToTimeSec, nearestBarIndexByTime, timeSecToLogical } from './chart-time';

// Pure logical<->time helpers live in chart-time.ts; re-exported for existing importers.
export { isNearOldestLoaded, logicalToTimeSec, nearestBarIndexByTime, timeSecToLogical };

// How close (in bars' worth of calendar time) the visible range's `from` must get to the
// panel's own oldest loaded bar before `loadOlder()` is requested. A time-based proximity
// check rather than an absolute bar-index one: see the "loadOlder() pagination trigger
// unreachable at real-data buffer depth" follow-up in
// architecture/scroll-back-freeze-diagnosis.md — an index threshold assumes the visible
// viewport can always reach it via zoom or pan, which lightweight-charts' own
// `minBarSpacing` zoom floor breaks once a panel's loaded buffer (HISTORY_LIMIT) exceeds
// roughly panelWidthPx / 0.5 bars, as it now routinely does against real backfilled data.
const NEAR_START_BAR_MULTIPLIER = 5;

/**
 * Owns the lightweight-charts instance (§5.2, extended by §6.6). Pure
 * presentational component: candles/points/overlays come in as inputs,
 * pagination requests go out as an output — no store/API knowledge here.
 *
 * `kind` picks the series type: `'candles'` draws a candlestick series and
 * attaches `OverlayLayer` (signal markers etc.); `'metric'` draws one series via
 * `MetricSeriesRenderer` (§11.2) and never attaches overlays — a metric panel's `signals`
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
  templateUrl: './chart.component.html',
  styleUrl: './chart.component.scss',
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
  /** §9.1 position tools (replay only): what to draw, whether pointer hits are handled, the changes. */
  readonly positionTools = input<PositionToolsView | null>(null);
  readonly positionToolsEnabled = input(false);
  readonly positionToolChange = output<PositionToolChange>();
  readonly loadOlderRequested = output<void>();

  readonly markerCount = computed(() => this.overlays().filter((o) => o.type === 'marker').length);
  readonly indicatorSeriesCount = signal(0);
  readonly visibleFrom = signal<number | null>(null);
  readonly visibleTo = signal<number | null>(null);

  private readonly sync = inject(ChartSyncService);
  private readonly crosshair = new ChartCrosshair(
    {
      chart: () => this.chart,
      series: () => this.series,
      panelId: () => this.panelId(),
      timesSec: () => this.lastTimesSec,
      tfSec: () => this.tfSec(),
      valueAt: (idx) =>
        this.kind() === 'candles' ? this.candles()[idx]?.close : metricPlottedClose(this.points()[idx]),
    },
    this.sync,
  );
  readonly crosshairTime = this.crosshair.time;
  /** The price at the crosshair's horizontal line (see ChartCrosshair.price); for the position tool. */
  readonly crosshairPrice = this.crosshair.price;

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  private readonly overlayLayer = new OverlayLayer();
  private readonly shapesPrimitive = new ShapesPrimitive();
  private readonly indicatorLayer = new IndicatorLayer();
  private readonly metricSeries = new MetricSeriesRenderer();
  private readonly positionToolLayer = new PositionToolLayer({
    chart: () => this.chart,
    series: () => this.series,
    view: () => this.positionTools(),
    enabled: () => this.positionToolsEnabled() && this.kind() === 'candles',
    lastClose: () => this.candles().at(-1)?.close ?? null,
    emit: (change) => this.positionToolChange.emit(change),
  });
  private lastRenderedCount = 0;
  private lastRenderedTime: number | null = null; // candle openTime or metric point time, seconds-scale source (ms)
  /**
   * This panel's own bar times, seconds-scale, ascending — index `i` matches logical index `i`
   * (the array `setData`/`series.update()` was last given). Kept in sync at the end of
   * `renderCandles`/`renderPoints`; used by every logical<->time conversion below (bug 3's
   * `logicalToTimeSec`/`timeSecToLogical`) instead of re-deriving it from `candles()`/`points()`
   * inline, so the Follow effect's prepend-preservation reads the PRE-`setData` array.
   */
  private lastTimesSec: number[] = [];

  /** Follow, Drive and the reentrancy guards between them (chart-range-sync.ts). */
  private readonly rangeSync = new ChartRangeSync(
    {
      chart: () => this.chart,
      panelId: () => this.panelId(),
      timesSec: () => this.lastTimesSec,
      tfSec: () => this.tfSec(),
      renderedCount: () => this.lastRenderedCount,
      resizing: () => this.resizeSettle.resizing,
    },
    this.sync,
  );

  /** §11.3 sync rule 3: while the container is resizing, range changes never propose; once settled, re-join the shared range. */
  private readonly resizeSettle = new ResizeSettleTracker(() => this.rangeSync.reapplyShared());
  private stopResizeObserver: () => void = () => undefined;

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

    effect(() => this.positionToolLayer.render(this.positionTools(), this.positionToolsEnabled()));

    effect(() => {
      const points = this.indicatorPoints();
      const specs = this.indicatorSpecs();
      const tf = this.timeframe();
      this.indicatorLayer.render(points, specs, tf);
      this.indicatorSeriesCount.set(this.indicatorLayer.visibleSeriesCount());
    });

    // Follow (§6.4 step 2, redriven on the logical range — bug 3): apply a range proposed by
    // another panel in this grid. Driving/following on LOGICAL indices instead of
    // `lightweight-charts`' clamped visible TIME range is the fix itself: a time range cannot
    // represent empty space past the last (or before the first) bar — see the diagnosis's
    // "Root cause" — so `ChartSyncService`/`TimeRange` still carry edge TIMES (unchanged
    // contract), but they are converted to/from this panel's own logical indices via
    // `logicalToTimeSec`/`timeSecToLogical` on the way in and out.
    effect(() => {
      this.rangeSync.follow(this.sync.range(), this.sync.origin());
    });

    // §11.3 sync rule 3: after a sibling collapses/restores, EVERY chart (the origin included)
    // re-applies the current shared range to its new width. A chart still mid-resize skips it:
    // its own resize-settle re-applies the then-current range anyway.
    effect(() => {
      this.sync.reassertEpoch();
      untracked(() => {
        if (!this.resizeSettle.resizing) {
          this.rangeSync.reapplyShared();
        }
      });
    });

    // Follow, crosshair (bug 1, design point 3): a SEPARATE channel from the range sync above —
    // never routes through `propose()`/the circuit breaker, which are tuned for the range
    // feedback loop this has none of (see `ChartSyncService.setCrosshair`'s doc and point 4
    // below).
    effect(() => {
      // Read the signal FIRST: Angular's effect() only re-runs on a signal it actually read
      // before returning on a given run, so `this.chart`/`this.series` (plain fields, not
      // signals, both still null on this effect's first run in the constructor, before
      // ngAfterViewInit) must never gate the read of `sync.crosshair()` itself.
      const cross = this.sync.crosshair();
      this.crosshair.follow(cross);
    });
  }

  ngAfterViewInit(): void {
    const el = this.container().nativeElement;
    const isCandles = this.kind() === 'candles';
    this.stopResizeObserver = observeResize(el, this.resizeSettle); // before createChart — see observeResize
    this.chart = createChart(el, CHART_OPTIONS);

    this.series = isCandles
      ? this.chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS)
      : this.metricSeries.attach(this.chart, this.timeframe());

    if (isCandles) {
      this.overlayLayer.attachAll(this.chart, this.series);
      this.positionToolLayer.attach(el, this.series);
    }
    this.indicatorLayer.attach(this.chart);

    // Drive (§6.4 step 1, redriven on the logical range — bug 3): a USER-driven (or
    // library-initiated, e.g. autofit on first data) range change proposes the new shared
    // range, unless it is this component's own programmatic setVisibleLogicalRange() echoing
    // back. Driving from `subscribeVisibleLogicalRangeChange` instead of the time-range
    // equivalent is the fix: `getVisibleRange()`/`subscribeVisibleTimeRangeChange` clamp `to`
    // to the last loaded bar (`timeRangeForLogicalRange`), so a pan past the right edge cannot
    // even be OBSERVED as anything other than "the same last bar, shrinking `from`" — see the
    // diagnosis's "Root cause". The logical range has no such clamp; converting its (possibly
    // fractional, possibly beyond-data) ends through `logicalToTimeSec` is what makes the void
    // representable on the shared `TimeRange` channel at all.
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange) {
        this.visibleFrom.set(null);
        this.visibleTo.set(null);
        return;
      }
      const timesSec = this.lastTimesSec;
      if (timesSec.length === 0) {
        // No data on this panel yet: nothing to anchor a logical<->time conversion against.
        // Once this panel's own history lands, renderCandles/renderPoints's own setData()
        // triggers this same callback again with real data behind it.
        return;
      }
      const tf = this.tfSec();
      const fromSec = logicalToTimeSec(logicalRange.from, timesSec, tf);
      const toSec = logicalToTimeSec(logicalRange.to, timesSec, tf);

      this.visibleFrom.set(fromSec);
      this.visibleTo.set(toSec);

      // Pagination trigger: fires on ANY range change that gets close to the oldest loaded
      // bar, regardless of `applying`/sync origin — a follower panel snapping to a proposed
      // range near its own start still needs to page in more history. `fromSec` sitting in the
      // left whitespace (extrapolated past this panel's own first bar) is trivially "near the
      // oldest bar", which is correct: `loadOlder()`'s own `noMoreOlderHistory` guard is what
      // stops the requests once the store is actually exhausted (see the diagnosis's fix step 2).
      if (this.isNearThisPanelsOldestLoaded(fromSec)) {
        this.loadOlderRequested.emit();
      }

      this.rangeSync.drive(fromSec, toSec);
    });

    // BUG-007: only a real gesture lets this panel's range changes propose before the grid is user-driven.
    for (const type of ['pointerdown', 'wheel'] as const) {
      el.addEventListener(type, () => this.rangeSync.noteGesture(), { capture: true, passive: true });
    }

    // Drive, crosshair: see ChartCrosshair.drive for the loop-prevention layers.
    this.chart.subscribeCrosshairMove((param) => this.crosshair.drive(param));

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

  /** The shared timeframe (§6.3 — every panel in a grid is on it), in seconds. */
  private tfSec(): number {
    return TIMEFRAME_MS[this.timeframe()] / 1000;
  }

  /** Oldest loaded bar's open/point time, ms-epoch (wire scale) — null if nothing's loaded yet. */
  private oldestLoadedTimeMs(): number | null {
    if (this.kind() === 'candles') {
      const candles = this.candles();
      return candles.length > 0 ? candles[0].openTime : null;
    }
    const points = this.points();
    return points.length > 0 ? points[0].time : null;
  }

  /**
   * Time-based near-start check (replaces the old absolute logical-index one) for this panel's
   * own oldest loaded bar. Invariant to total buffer size and to which gesture (zoom vs. pan)
   * produced the range change, unlike a bar-index threshold — see `isNearOldestLoaded`'s
   * comment.
   */
  private isNearThisPanelsOldestLoaded(visibleFromSec: number): boolean {
    return isNearOldestLoaded(visibleFromSec, this.oldestLoadedTimeMs(), this.timeframe(), NEAR_START_BAR_MULTIPLIER);
  }

  private renderCandles(candles: Candle[]): void {
    if (!this.series || this.kind() !== 'candles') {
      return;
    }
    const series = this.series as ISeriesApi<'Candlestick'>;
    const wasEmpty = this.lastRenderedCount === 0;
    if (candles.length === 0) {
      series.setData([]);
      this.lastRenderedCount = 0;
      this.lastRenderedTime = null;
      this.lastTimesSec = [];
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

    const timesSec = candles.map((c) => c.openTime / 1000);
    if (isIncrementalAppendOrUpdate) {
      const last = candles[candles.length - 1];
      series.update(toCandlestickData(last));
    } else {
      this.rangeSync.withPreservedRangeOnPrepend(isPrepend, timesSec, () => series.setData(toCandlestickSeries(candles)));
    }
    this.lastRenderedCount = candles.length;
    this.lastRenderedTime = candles[candles.length - 1].openTime;
    this.lastTimesSec = timesSec;
    this.rangeSync.joinOnFirstData(wasEmpty);
  }

  private renderPoints(points: MetricPoint[]): void {
    // Read timeframe() before any early return, so the render effect re-runs on a timeframe change.
    if (this.metricSeries.setTimeframe(this.timeframe())) {
      // §11.2 line <-> candles swap: the new series is empty, so it takes the first-data path —
      // full setData, then JOIN the shared range (§11.3 rule 2), never propose its autofit.
      this.series = this.metricSeries.series;
      this.lastRenderedCount = 0;
      this.lastRenderedTime = null;
      this.lastTimesSec = [];
    }
    if (!this.series || this.kind() !== 'metric') {
      return;
    }
    const wasEmpty = this.lastRenderedCount === 0;
    if (points.length === 0) {
      this.metricSeries.setData([]);
      this.lastRenderedCount = 0;
      this.lastRenderedTime = null;
      this.lastTimesSec = [];
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

    const timesSec = points.map((p) => p.time / 1000);
    if (isIncrementalAppendOrUpdate) {
      const last = points[points.length - 1];
      this.metricSeries.update(last);
    } else {
      this.rangeSync.withPreservedRangeOnPrepend(isPrepend, timesSec, () => this.metricSeries.setData(points));
    }
    this.lastRenderedCount = points.length;
    this.lastRenderedTime = points[points.length - 1].time;
    this.lastTimesSec = timesSec;
    this.rangeSync.joinOnFirstData(wasEmpty);
  }

  ngOnDestroy(): void {
    // §11.3 sync rule 1: a collapsed panel's chart is destroyed, not hidden.
    this.stopResizeObserver();
    this.resizeSettle.dispose();
    this.sync.releaseCrosshair(this.panelId());
    this.positionToolLayer.detach();
    this.overlayLayer.clearAll();
    this.indicatorLayer.clearAll();
    this.chart?.remove();
  }
}
