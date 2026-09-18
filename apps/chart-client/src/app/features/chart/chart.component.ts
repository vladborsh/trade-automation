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
  type IChartApi,
  type ISeriesApi,
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
import { metricPlottedClose, toCandlestickData, toCandlestickSeries } from './chart-data.adapter';
import { MetricSeriesRenderer } from './metric-series.renderer';
import { OverlayLayer } from './overlay/overlay-layer';
import { MarkerRenderer } from './overlay/marker.renderer';
import { PriceLineRenderer } from './overlay/price-line.renderer';
import { RectRenderer } from './overlay/rect.renderer';
import { RayRenderer } from './overlay/ray.renderer';
import { LineRenderer } from './overlay/line.renderer';
import { ShapesPrimitive } from './overlay/shapes.primitive';
import { IndicatorLayer } from './indicator/indicator-layer';
import { ChartSyncService, sameRange, type TimeRange } from './chart-sync.service';

/**
 * Pure, exported for direct unit testing (no chart/DI needed) — see
 * architecture/panel-sync-and-oi-depth-diagnosis.md bug 3.
 *
 * Converts a `lightweight-charts` logical index (fractional — `getVisibleLogicalRange()`
 * returns e.g. `-3.5`) to a wall-clock second, using this panel's own bar times. Inside the
 * data, linear interpolation between the two neighbouring bars (this is what lets an
 * interpolated instant land INSIDE a real gap, not snap onto a bar). Beyond either end,
 * extrapolation by `tfSec` — this is what makes empty space past the last (or before the
 * first) bar representable at all, which is the whole fix: `lightweight-charts`' own
 * `getVisibleRange()`/`setVisibleRange()` cannot express it (see the diagnosis's "Root cause").
 */
export function logicalToTimeSec(logical: number, timesSec: readonly number[], tfSec: number): number {
  const lastIdx = timesSec.length - 1;
  if (logical <= 0) {
    return timesSec[0] + logical * tfSec;
  }
  if (logical >= lastIdx) {
    return timesSec[lastIdx] + (logical - lastIdx) * tfSec;
  }
  const lo = Math.floor(logical);
  const hi = lo + 1;
  const frac = logical - lo;
  return timesSec[lo] + frac * (timesSec[hi] - timesSec[lo]);
}

/** The inverse of `logicalToTimeSec` — binary search for the bracketing bars, extrapolate by `tfSec` beyond either end. */
export function timeSecToLogical(timeSec: number, timesSec: readonly number[], tfSec: number): number {
  const lastIdx = timesSec.length - 1;
  if (timeSec <= timesSec[0]) {
    return (timeSec - timesSec[0]) / tfSec;
  }
  if (timeSec >= timesSec[lastIdx]) {
    return lastIdx + (timeSec - timesSec[lastIdx]) / tfSec;
  }
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesSec[mid] <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = timesSec[hi] - timesSec[lo];
  const frac = span === 0 ? 0 : (timeSec - timesSec[lo]) / span;
  return lo + frac;
}

/**
 * Nearest loaded bar to `timeSec` by wall-clock distance (binary search) — used to place a
 * follower's own horizontal crosshair line (bug 1): each follower reads its OWN value at the
 * driver's hovered instant, never the driver's price (units differ per panel).
 */
export function nearestBarIndexByTime(timeSec: number, timesSec: readonly number[]): number {
  const lastIdx = timesSec.length - 1;
  if (timeSec <= timesSec[0]) {
    return 0;
  }
  if (timeSec >= timesSec[lastIdx]) {
    return lastIdx;
  }
  let lo = 0;
  let hi = lastIdx;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timesSec[mid] <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return timeSec - timesSec[lo] <= timesSec[hi] - timeSec ? lo : hi;
}

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
 * Pure form of the near-start check, exported for direct unit testing (no chart/DI needed):
 * true once `visibleFromSec` (UTC seconds, lightweight-charts scale) is within
 * `barMultiplier` bars' worth of calendar time — at the given `timeframe` — of `oldestMs`
 * (ms-epoch, wire scale). `oldestMs === null` (nothing loaded yet) is never near.
 */
export function isNearOldestLoaded(
  visibleFromSec: number,
  oldestMs: number | null,
  timeframe: Timeframe,
  barMultiplier: number,
): boolean {
  if (oldestMs === null) {
    return false;
  }
  const thresholdMs = TIMEFRAME_MS[timeframe] * barMultiplier;
  return visibleFromSec * 1000 - oldestMs <= thresholdMs;
}

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
  template: `<div
    class="chart-container"
    #container
    [attr.data-marker-count]="markerCount()"
    [attr.data-indicator-series-count]="indicatorSeriesCount()"
    [attr.data-visible-from]="visibleFrom()"
    [attr.data-visible-to]="visibleTo()"
    [attr.data-crosshair-time]="crosshairTime()"
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
  readonly crosshairTime = signal<number | null>(null);

  private readonly sync = inject(ChartSyncService);

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null = null;
  private readonly overlayLayer = new OverlayLayer();
  private readonly shapesPrimitive = new ShapesPrimitive();
  private readonly indicatorLayer = new IndicatorLayer();
  private readonly metricSeries = new MetricSeriesRenderer();
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

    // Follow (§6.4 step 2, redriven on the logical range — bug 3): apply a range proposed by
    // another panel in this grid. Driving/following on LOGICAL indices instead of
    // `lightweight-charts`' clamped visible TIME range is the fix itself: a time range cannot
    // represent empty space past the last (or before the first) bar — see the diagnosis's
    // "Root cause" — so `ChartSyncService`/`TimeRange` still carry edge TIMES (unchanged
    // contract), but they are converted to/from this panel's own logical indices via
    // `logicalToTimeSec`/`timeSecToLogical` on the way in and out.
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

      if (this.applying) {
        return;
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
  }

  private renderPoints(points: MetricPoint[]): void {
    // Read timeframe() before any early return, so the render effect re-runs on a timeframe change.
    if (this.metricSeries.setTimeframe(this.timeframe())) {
      this.series = this.metricSeries.series;
      this.lastRenderedCount = 0; // §11.2: line <-> candles swapped; the new series needs a full setData
    }
    if (!this.series || this.kind() !== 'metric') {
      return;
    }
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
  }

  ngOnDestroy(): void {
    this.overlayLayer.clearAll();
    this.indicatorLayer.clearAll();
    this.chart?.remove();
  }
}
