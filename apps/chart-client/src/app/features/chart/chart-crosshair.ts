import { signal } from '@angular/core';
import type { IChartApi, ISeriesApi, MouseEventParams, Time, UTCTimestamp } from 'lightweight-charts';
import type { ChartSyncService, CrosshairState } from './chart-sync.service';
import { logicalToTimeSec, nearestBarIndexByTime } from './chart-time';

/** What the crosshair needs from its `ChartComponent` — read at call time, never cached. */
export interface CrosshairHost {
  chart(): IChartApi | null;
  series(): ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | null;
  panelId(): string;
  /** This panel's own bar times, seconds-scale, ascending (`ChartComponent.lastTimesSec`). */
  timesSec(): number[];
  tfSec(): number;
  /** The plotted value of bar `idx` (candle close, or the metric's plotted close). */
  valueAt(idx: number): number | undefined;
}

/**
 * The chart's half of the cross-panel crosshair sync (bug 1 of
 * architecture/panel-sync-and-oi-depth-diagnosis.md), moved out of `ChartComponent`
 * unchanged: `follow()` is the body of its Follow effect, `drive()` its
 * `subscribeCrosshairMove` handler. `time` is the hovered/followed instant, seconds.
 *
 * `price` is the price at the crosshair's horizontal line, null whenever `time` is: on the
 * panel under the pointer, the price at the pointer's y (what the position tool places a level
 * at); on a following panel, the value its crosshair snaps to (that bar's plotted close).
 */
export class ChartCrosshair {
  readonly time = signal<number | null>(null);
  readonly price = signal<number | null>(null);

  constructor(
    private readonly host: CrosshairHost,
    private readonly sync: ChartSyncService,
  ) {}

  /** Follow: apply the shared crosshair (read by the caller's effect) to this chart. */
  follow(cross: CrosshairState | null): void {
    const chart = this.host.chart();
    const series = this.host.series();
    if (!chart || !series) {
      return;
    }
    if (!cross) {
      chart.clearCrosshairPosition();
      this.time.set(null);
      this.price.set(null);
      return;
    }
    if (cross.origin === this.host.panelId()) {
      // The driver keeps its own native crosshair (and already cleared its own
      // `crosshairTime` directly from its Drive handler on leave); only followers write here.
      return;
    }
    const timesSec = this.host.timesSec();
    if (timesSec.length === 0) {
      return;
    }
    const idx = nearestBarIndexByTime(cross.timeSec, timesSec);
    // Known limitation, accepted for v1 (see design doc point 6): this snaps to the nearest
    // bar via lightweight-charts' own timeToIndex(findNearest=true), so a follower with no
    // bar at this exact instant (dxy over a weekend, an OI panel before its first point)
    // draws on its nearest bar, not at the exact wall-clock x.
    const value = this.host.valueAt(idx);
    if (value === undefined) {
      return;
    }
    chart.setCrosshairPosition(value, timesSec[idx] as UTCTimestamp, series);
    this.time.set(timesSec[idx]);
    this.price.set(value);
  }

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
  //   3. Origin skip, in `follow()` above: a follower never writes back regardless.
  drive(param: MouseEventParams<Time>): void {
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
      this.time.set(null);
      this.price.set(null);
      this.sync.setCrosshair(this.host.panelId(), null);
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
    const timesSec = this.host.timesSec();
    if (timesSec.length === 0) {
      return;
    }
    // `param.logical` (not `param.time`) so hovering the void (past the last/before the
    // first bar) still syncs at the right wall-clock instant — `param.time` is undefined
    // there, but `param.logical` is defined everywhere on the pane.
    const timeSec = logicalToTimeSec(param.logical, timesSec, this.host.tfSec());
    this.time.set(timeSec);
    this.price.set(this.host.series()?.coordinateToPrice(param.point.y) ?? null);
    this.sync.setCrosshair(this.host.panelId(), timeSec);
  }
}
