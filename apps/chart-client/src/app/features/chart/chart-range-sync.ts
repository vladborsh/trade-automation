import { untracked } from '@angular/core';
import type { IChartApi } from 'lightweight-charts';
import { type ChartSyncService, sameRange, type TimeRange } from './chart-sync.service';
import { logicalToTimeSec, timeSecToLogical } from './chart-time';

/** What the range sync needs from its `ChartComponent` — read at call time, never cached. */
export interface RangeSyncHost {
  chart(): IChartApi | null;
  panelId(): string;
  /** This panel's own bar times, seconds-scale, ascending (`ChartComponent.lastTimesSec`). */
  timesSec(): number[];
  tfSec(): number;
  /** Bars currently on this panel's series (`ChartComponent.lastRenderedCount`). */
  renderedCount(): number;
  /** §11.3 sync rule 3: the container is mid-resize — its range changes never propose. */
  resizing(): boolean;
}

/**
 * The chart's half of the cross-panel visible-range sync (architecture/chart-layouts.md §6.4,
 * §11.3; panel-sync-and-oi-depth-diagnosis.md bug 3), moved out of `ChartComponent` unchanged:
 * applying a shared range (Follow), re-applying it (reassert, resize-settle, first-data join),
 * proposing this panel's own changes (Drive), and preserving the visible edge times across a
 * prepend. Owns the two reentrancy guards that keep Follow and Drive from echoing.
 */
export class ChartRangeSync {
  /** Reentrancy guard 1 (§6.4): suppresses the range-change callback fired synchronously by our own setVisibleRange(). */
  private applying = false;
  /** Reentrancy guard 2 (§6.4): suppresses an async echo and a follower's own bar-grid "snap" of the applied range. */
  private lastApplied: TimeRange | null = null;
  /** BUG-007: a pointer or wheel gesture has reached this panel's chart (see `drive`). */
  private gestured = false;

  constructor(
    private readonly host: RangeSyncHost,
    private readonly sync: ChartSyncService,
  ) {}

  /** Follow (§6.4 step 2): apply a range proposed by another panel in this grid (read by the caller's effect). */
  follow(range: TimeRange | null, origin: string | null): void {
    if (!range || origin === this.host.panelId()) {
      return;
    }
    this.apply(range);
  }

  /**
   * Drive (§6.4 step 1): a visible-range change on this panel proposes the new shared range,
   * unless it is this panel's own programmatic apply echoing back.
   */
  drive(fromSec: number, toSec: number): void {
    if (this.applying || this.host.resizing()) {
      return; // our own programmatic apply, or a resize-driven change (§11.3 rule 3) — never a proposal
    }
    const eps = this.epsilonSec();
    const proposed: TimeRange = { from: fromSec, to: toSec };
    if (sameRange(proposed, this.lastApplied, eps)) {
      return;
    }
    if (!this.gestured && !this.sync.isUserDriven()) {
      // BUG-007, boot: nobody has touched the grid, so this is the library settling a window
      // (the autofit re-fitting once the price axis has its width, a new bar shifting it). The
      // seed's own panel refines the seed; any other panel goes back to the shared range. A
      // propose here would make the last panel to settle the origin — the boot race.
      if (this.sync.origin() === this.host.panelId()) {
        this.lastApplied = proposed;
        this.sync.seed(this.host.panelId(), proposed);
      } else {
        this.reapplyShared();
      }
      return;
    }
    this.sync.propose(this.host.panelId(), proposed, eps);
  }

  /** A pointer or wheel gesture on this panel's chart: from now on its range changes propose. */
  noteGesture(): void {
    this.gestured = true;
  }

  /**
   * Applies a shared range to this panel under the `applying` guard (§6.4 Follow, bug 3's
   * logical-range form). Used by the Follow effect, by reassert/resize-settle (§11.3 rule 3) and
   * by the first-data join (§11.3 rule 2).
   */
  apply(range: TimeRange): void {
    const chart = this.host.chart();
    if (!chart || this.host.renderedCount() === 0) {
      // No data on this panel's series yet: lightweight-charts cannot map a
      // time range to a logical range with nothing to map it against, and
      // throws. Once this panel's own history lands, `renderCandles`/
      // `renderPoints` joins the shared range (§11.3 rule 2), so
      // skipping here loses nothing.
      return;
    }
    const timesSec = this.host.timesSec();
    if (timesSec.length === 0) {
      return;
    }
    const tf = this.host.tfSec();
    this.applying = true;
    try {
      chart.timeScale().setVisibleLogicalRange({
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
      const live = this.host.chart();
      if (!live) {
        this.applying = false;
        return;
      }
      const applied = live.timeScale().getVisibleLogicalRange();
      this.lastApplied = applied
        ? { from: logicalToTimeSec(applied.from, this.host.timesSec(), tf), to: logicalToTimeSec(applied.to, this.host.timesSec(), tf) }
        : range;
      this.applying = false;
    });
  }

  /** Re-applies the current shared range (if any) regardless of origin — §11.3 rules 2 and 3. */
  reapplyShared(): void {
    untracked(() => {
      const range = this.sync.range();
      if (range) {
        this.apply(range);
      }
    });
  }

  /**
   * First data on this panel (§11.3 rule 2, BUG-007). Once the grid is user-driven, the chart
   * JOINS the shared range and never proposes its own autofit window. Before that, the autofit
   * window is offered as a `seed()` — the freshest seed wins regardless of arrival order — and
   * the chart joins whatever seed stands. Either way `lastApplied` / `applying` absorb the
   * autofit's own range-change echo, so first data never reaches `propose()`.
   */
  joinOnFirstData(wasEmpty: boolean): void {
    if (!wasEmpty || this.host.renderedCount() === 0) {
      return;
    }
    untracked(() => {
      if (!this.sync.isUserDriven()) {
        this.seedOwnWindow();
      }
      if (this.sync.origin() !== this.host.panelId()) {
        this.reapplyShared();
      }
    });
  }

  private seedOwnWindow(): void {
    const r = this.host.chart()?.timeScale().getVisibleLogicalRange();
    const timesSec = this.host.timesSec();
    if (!r || timesSec.length === 0) {
      return;
    }
    const tf = this.host.tfSec();
    const own: TimeRange = { from: logicalToTimeSec(r.from, timesSec, tf), to: logicalToTimeSec(r.to, timesSec, tf) };
    this.lastApplied = own;
    this.sync.seed(this.host.panelId(), own);
  }

  /** Half a bar of the current timeframe, in seconds — larger than any bar-grid snap (§6.4). */
  epsilonSec(): number {
    return this.host.tfSec() / 2;
  }

  /**
   * Captures the visible EDGE TIMES before a full `setData()` (a prepend), restores them after,
   * under the `applying` guard. Preserves *times*, not the logical range itself — a prepend
   * shifts every existing bar's logical index forward, so the old logical range would point at
   * the wrong bars against the new array; times survive the shift unchanged (design doc, bug 3
   * fix step 4). Reads against the host's `timesSec()` (the PRE-prepend array, still what the chart
   * is actually showing at read time) and re-applies against `newTimesSec` (the POST-prepend
   * array `setData` was just given).
   */
  withPreservedRangeOnPrepend(isPrepend: boolean, newTimesSec: readonly number[], setData: () => void): void {
    const tf = this.host.tfSec();
    const chart = this.host.chart();
    const oldTimesSec = this.host.timesSec();
    let preserved: TimeRange | null = null;
    if (isPrepend && chart && oldTimesSec.length > 0) {
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r) {
        preserved = { from: logicalToTimeSec(r.from, oldTimesSec, tf), to: logicalToTimeSec(r.to, oldTimesSec, tf) };
      }
    }

    setData();

    if (preserved && chart && newTimesSec.length > 0) {
      this.applying = true;
      try {
        chart.timeScale().setVisibleLogicalRange({
          from: timeSecToLogical(preserved.from, newTimesSec, tf),
          to: timeSecToLogical(preserved.to, newTimesSec, tf),
        });
        this.lastApplied = preserved;
      } finally {
        this.applying = false;
      }
    }
  }
}
