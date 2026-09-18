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
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
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
import { MetricSeriesRenderer } from './metric-series.renderer';
import { CHART_OPTIONS, PRICE_CANDLE_OPTIONS } from './chart-theme';
import { DaySeparatorsPrimitive } from './day-separators.primitive';
import { nyTickMarkFormatter } from './ny-time';
import { OverlayLayer } from './overlay/overlay-layer';
import { MarkerRenderer } from './overlay/marker.renderer';
import { PriceLineRenderer } from './overlay/price-line.renderer';
import { RectRenderer } from './overlay/rect.renderer';
import { RayRenderer } from './overlay/ray.renderer';
import { LineRenderer } from './overlay/line.renderer';
import { ShapesPrimitive } from './overlay/shapes.primitive';
import { IndicatorLayer } from './indicator/indicator-layer';
import { ChartSyncService, sameRange, type TimeRange } from './chart-sync.service';
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
  readonly loadOlderRequested = output<void>();

  readonly markerCount = computed(() => this.overlays().filter((o) => o.type === 'marker').length);
  readonly indicatorSeriesCount = signal(0);
  readonly visibleFrom = signal<number | null>(null);
  readonly visibleTo = signal<number | null>(null);
  readonly crosshairTime = signal<number | null>(null);

  private readonly sync = inject(ChartSyncService);

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  private readonly overlayLayer = new OverlayLayer();
  private readonly shapesPrimitive = new ShapesPrimitive();
  private readonly indicatorLayer = new IndicatorLayer();
  private readonly metricSeries = new MetricSeriesRenderer();
  private readonly daySeparators = new DaySeparatorsPrimitive();
  private axisTf: Timeframe | null = null;
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

  /** Reentrancy guard 1 (§6.4): suppresses the range-change callback fired synchronously by our own setVisibleRange(). */
  private applying = false;
  /** Reentrancy guard 2 (§6.4): suppresses an async echo and a follower's own bar-grid "snap" of the applied range. */
  private lastApplied: TimeRange | null = null;

  /** §11.3 sync rule 3: while the container is resizing, range changes never propose; once settled, re-join the shared range. */
  private readonly resizeSettle = new ResizeSettleTracker(() => this.reapplySharedRange());
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
      untracked(() => this.renderTimeDecor());
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

    // Follow (§6.4 step 2, redriven on the logical range — bug 3): apply a range proposed by
    // another panel in this grid. Driving/following on LOGICAL indices instead of
    // `lightweight-charts`' clamped visible TIME range is the fix itself: a time range cannot
    // represent empty space past the last (or before the first) bar — see the diagnosis's
    // "Root cause" — so `ChartSyncService`/`TimeRange` still carry edge TIMES (unchanged
    // contract), but they are converted to/from this panel's own logical indices via
    // `logicalToTimeSec`/`timeSecToLogical` on the way in and out.
    effect(() => {
      const range = this.sync.range();
      if (!range || this.sync.origin() === this.panelId()) {
        return;
      }
      this.applyRange(range);
    });

    // §11.3 sync rule 3: after a sibling collapses/restores, EVERY chart (the origin included)
    // re-applies the current shared range to its new width. A chart still mid-resize skips it:
    // its own resize-settle re-applies the then-current range anyway.
    effect(() => {
      this.sync.reassertEpoch();
      untracked(() => {
        if (!this.resizeSettle.resizing) {
          this.reapplySharedRange();
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
      if (!this.chart || !this.series) {
        return;
      }
      if (!cross) {
        this.chart.clearCrosshairPosition();
        this.crosshairTime.set(null);
        return;
      }
      if (cross.origin === this.panelId()) {
        // The driver keeps its own native crosshair (and already cleared its own
        // `crosshairTime` directly from its Drive handler on leave); only followers write here.
        return;
      }
      const timesSec = this.lastTimesSec;
      if (timesSec.length === 0) {
        return;
      }
      const idx = nearestBarIndexByTime(cross.timeSec, timesSec);
      // Known limitation, accepted for v1 (see design doc point 6): this snaps to the nearest
      // bar via lightweight-charts' own timeToIndex(findNearest=true), so a follower with no
      // bar at this exact instant (dxy over a weekend, an OI panel before its first point)
      // draws on its nearest bar, not at the exact wall-clock x.
      const value = this.kind() === 'candles' ? this.candles()[idx]?.close : metricPlottedClose(this.points()[idx]);
      if (value === undefined) {
        return;
      }
      this.chart.setCrosshairPosition(value, timesSec[idx] as UTCTimestamp, this.series);
      this.crosshairTime.set(timesSec[idx]);
    });
  }

  ngAfterViewInit(): void {
    const el = this.container().nativeElement;
    const isCandles = this.kind() === 'candles';
    this.stopResizeObserver = observeResize(el, this.resizeSettle); // before createChart — see observeResize
    this.chart = createChart(el, CHART_OPTIONS);
    this.daySeparators.attachTo(this.chart.panes()[0]);
    this.series = isCandles
      ? this.chart.addSeries(CandlestickSeries, PRICE_CANDLE_OPTIONS)
      : this.metricSeries.attach(this.chart, this.timeframe());

    if (isCandles) {
      this.overlayLayer.attachAll(this.chart, this.series);
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

      if (this.applying || this.resizeSettle.resizing) {
        return; // our own programmatic apply, or a resize-driven change (§11.3 rule 3) — never a proposal
      }
      const eps = this.syncEpsilonSec();
      const proposed: TimeRange = { from: fromSec, to: toSec };
      if (sameRange(proposed, this.lastApplied, eps)) {
        return;
      }
      this.sync.propose(this.panelId(), proposed, eps);
    });

    // Drive, crosshair (bug 1, design point 2 + loop-prevention layer 2): hovering this panel
    // publishes the hovered wall-clock instant on the shared crosshair channel. Three
    // loop-prevention layers, per the design doc:
    //   1. By construction: lightweight-charts does not fire subscribeCrosshairMove for a
    //      programmatic setCrosshairPosition (setAndSaveSyntheticPosition passes
    //      skipEvent=true internally, verified in the 5.2.1 source) — a follower applying a
    //      position produces no event at all, so there is no echo to guard against.
    //   2. Explicit, here: only propose when `param.sourceEvent` is defined — undefined for
    //      anything programmatic — so a future library version that starts firing on synthetic
    //      positions still can't turn this into a two-way channel.
    //   3. Origin skip, in the Follow effect above: a follower never writes back regardless.
    this.chart.subscribeCrosshairMove((param) => {
      if (param.point === undefined) {
        // Mouse left the pane. Checked BEFORE the `sourceEvent` guard below: a genuine
        // mouse-leave calls the library's internal clear path with no event data at all
        // (verified in the 5.2.1 source — `_private__clearCrosshairPosition()` fires
        // `_crosshairMoved` with `(null, null, null)`, so `sourceEvent` is undefined here even
        // for a REAL leave), unlike a real move within the pane. That's harmless to gate on
        // `param.point` alone instead: per loop-prevention layer 1, the library never invokes
        // this callback AT ALL for a synthetic position (`setCrosshairPosition`/
        // `clearCrosshairPosition` both pass `skipEvent: true` internally) — so every call that
        // reaches here, leave included, is already a real user event, `sourceEvent` field or not.
        this.crosshairTime.set(null);
        this.sync.setCrosshair(this.panelId(), null);
        return;
      }
      if (param.sourceEvent === undefined) {
        // Defense-in-depth (loop-prevention layer 2): a hover WITH a point is only ever real
        // today (layer 1), but if a future library version starts firing this for a synthetic
        // position that carries a point, this keeps the channel one-directional.
        return;
      }
      if (param.logical === undefined) {
        return;
      }
      const timesSec = this.lastTimesSec;
      if (timesSec.length === 0) {
        return;
      }
      // `param.logical` (not `param.time`) so hovering the void (past the last/before the
      // first bar) still syncs at the right wall-clock instant — `param.time` is undefined
      // there, but `param.logical` is defined everywhere on the pane.
      const timeSec = logicalToTimeSec(param.logical, timesSec, this.tfSec());
      this.crosshairTime.set(timeSec);
      this.sync.setCrosshair(this.panelId(), timeSec);
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
    this.renderTimeDecor();
  }

  /** §12.2/§12.3 display-only: NY axis labels for the timeframe, day separators for the bars. */
  private renderTimeDecor(): void {
    const tf = this.timeframe();
    this.daySeparators.setData(this.lastTimesSec, tf);
    if (this.chart && tf !== this.axisTf) {
      this.axisTf = tf;
      this.chart.applyOptions({ timeScale: { tickMarkFormatter: nyTickMarkFormatter(tf) } });
    }
  }

  /**
   * Applies a shared range to this panel under the `applying` guard (§6.4 Follow, bug 3's
   * logical-range form). Used by the Follow effect, by reassert/resize-settle (§11.3 rule 3) and
   * by the first-data join (§11.3 rule 2).
   */
  private applyRange(range: TimeRange): void {
    if (!this.chart || this.lastRenderedCount === 0) {
      // No data on this panel's series yet: lightweight-charts cannot map a
      // time range to a logical range with nothing to map it against, and
      // throws. Once this panel's own history lands, `renderCandles`/
      // `renderPoints` joins the shared range (§11.3 rule 2), so
      // skipping here loses nothing.
      return;
    }
    const timesSec = this.lastTimesSec;
    if (timesSec.length === 0) {
      return;
    }
    const tf = this.tfSec();
    this.applying = true;
    try {
      this.chart.timeScale().setVisibleLogicalRange({
        from: timeSecToLogical(range.from, timesSec, tf),
        to: timeSecToLogical(range.to, timesSec, tf),
      });
    } catch {
      // lightweight-charts can still reject a range outside this panel's
      // data domain (e.g. a market-hours instrument during a synced
      // window it has no bars for) — never let one panel's chart crash
      // the shared sync effect for the rest of the grid.
      this.applying = false;
      return;
    }
    // Read back what lightweight-charts actually rendered, not what we
    // asked for — but only on the NEXT animation frame, not synchronously.
    // A requested range landing inside this panel's own data gap (real
    // market data, e.g. a session closure) doesn't finish its snap-to-grid
    // settle inside setVisibleRange() itself; reading getVisibleLogicalRange()
    // right away can still capture a stale intermediate value, so the
    // later real async echo would still fail sameRange() against a
    // wrong lastApplied and re-propose (see
    // architecture/scroll-back-freeze-diagnosis.md). Deferring both the
    // read-back and clearing `applying` to the next frame keeps the Drive
    // handler suppressed until the settle has actually finished. A logical
    // range is applied exactly (only `minBarSpacing`/fixed-edge clamps are
    // left, and those are off), so this read-back is now mostly a formality
    // — but it stays, since that's what it's for.
    requestAnimationFrame(() => {
      if (!this.chart) {
        this.applying = false;
        return;
      }
      const applied = this.chart.timeScale().getVisibleLogicalRange();
      this.lastApplied = applied
        ? { from: logicalToTimeSec(applied.from, this.lastTimesSec, tf), to: logicalToTimeSec(applied.to, this.lastTimesSec, tf) }
        : range;
      this.applying = false;
    });
  }

  /** Re-applies the current shared range (if any) regardless of origin — §11.3 rules 2 and 3. */
  private reapplySharedRange(): void {
    untracked(() => {
      const range = this.sync.range();
      if (range) {
        this.applyRange(range);
      }
    });
  }

  /**
   * §11.3 sync rule 2 — a chart that mounts (or gets its first data) while a shared range exists
   * JOINS it and never proposes its own autofit window. The autofit range-change this `setData`
   * produced either arrives while `applying` is still set, or matches `lastApplied` — both drop
   * it. With no shared range yet, nothing happens here and today's boot seeding stands.
   */
  private joinSharedRangeOnFirstData(wasEmpty: boolean): void {
    if (wasEmpty && this.lastRenderedCount > 0) {
      this.reapplySharedRange();
    }
  }

  /** Half a bar of the current timeframe, in seconds — larger than any bar-grid snap (§6.4). */
  private syncEpsilonSec(): number {
    return this.tfSec() / 2;
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

  /**
   * Captures the visible EDGE TIMES before a full `setData()` (a prepend), restores them after,
   * under the `applying` guard. Preserves *times*, not the logical range itself — a prepend
   * shifts every existing bar's logical index forward, so the old logical range would point at
   * the wrong bars against the new array; times survive the shift unchanged (design doc, bug 3
   * fix step 4). Reads against `this.lastTimesSec` (the PRE-prepend array, still what the chart
   * is actually showing at read time) and re-applies against `newTimesSec` (the POST-prepend
   * array `setData` was just given).
   */
  private withPreservedRangeOnPrepend(isPrepend: boolean, newTimesSec: readonly number[], setData: () => void): void {
    const tf = this.tfSec();
    let preserved: TimeRange | null = null;
    if (isPrepend && this.chart && this.lastTimesSec.length > 0) {
      const r = this.chart.timeScale().getVisibleLogicalRange();
      if (r) {
        preserved = { from: logicalToTimeSec(r.from, this.lastTimesSec, tf), to: logicalToTimeSec(r.to, this.lastTimesSec, tf) };
      }
    }

    setData();

    if (preserved && this.chart && newTimesSec.length > 0) {
      this.applying = true;
      try {
        this.chart.timeScale().setVisibleLogicalRange({
          from: timeSecToLogical(preserved.from, newTimesSec, tf),
          to: timeSecToLogical(preserved.to, newTimesSec, tf),
        });
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
      this.withPreservedRangeOnPrepend(isPrepend, timesSec, () => series.setData(toCandlestickSeries(candles)));
    }
    this.lastRenderedCount = candles.length;
    this.lastRenderedTime = candles[candles.length - 1].openTime;
    this.lastTimesSec = timesSec;
    this.joinSharedRangeOnFirstData(wasEmpty);
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
      this.withPreservedRangeOnPrepend(isPrepend, timesSec, () => this.metricSeries.setData(points));
    }
    this.lastRenderedCount = points.length;
    this.lastRenderedTime = points[points.length - 1].time;
    this.lastTimesSec = timesSec;
    this.joinSharedRangeOnFirstData(wasEmpty);
  }

  ngOnDestroy(): void {
    // §11.3 sync rule 1: a collapsed panel's chart is destroyed, not hidden.
    this.stopResizeObserver();
    this.resizeSettle.dispose();
    this.sync.releaseCrosshair(this.panelId());
    this.overlayLayer.clearAll();
    this.indicatorLayer.clearAll();
    this.daySeparators.detach();
    this.chart?.remove();
  }
}
