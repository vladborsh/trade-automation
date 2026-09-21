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
    this.sync.propose(this.host.panelId(), proposed, eps);
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
   * §11.3 sync rule 2 — a chart that mounts (or gets its first data) while a shared range exists
   * JOINS it and never proposes its own autofit window. The autofit range-change this `setData`
   * produced either arrives while `applying` is still set, or matches `lastApplied` — both drop
   * it. With no shared range yet, nothing happens here and today's boot seeding stands.
   */
  joinOnFirstData(wasEmpty: boolean): void {
    if (wasEmpty && this.host.renderedCount() > 0) {
      this.reapplyShared();
    }
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
