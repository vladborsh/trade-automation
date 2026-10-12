import type { WebFrameCoverage } from '@trade-automation/contracts';

/**
 * IB-015 — pure display helpers for the feature-frame block of the coverage page (AGENTS.md:
 * anything that can be a pure function lives beside the component with its own spec).
 *
 * Its own block, deliberately not merged into the collector table above it. A stream can be live
 * for every hour of the window while every frame in it refuses: collector liveness says a socket
 * was connected and says nothing about whether the buckets it fed ever healed. Shown together,
 * a reader would take one as evidence about the other.
 *
 * The block's whole job is to keep three different kinds of "not fine" apart, because only one
 * of them is anybody's work:
 *
 * - **missing** — the frame was never written. Invisible in any count OF frames, which is
 *   IB-BUG-010 one layer up: "the pass was not running" must not look like "nothing was wrong".
 * - **unhealed** — a chaseable refusal that is past the heal window. The actionable figure.
 * - **explained** — refusals that are permanent. Visible, never an alarm; an alarm that cannot
 *   be cleared stops being read.
 */

export interface FrameView extends WebFrameCoverage {
  /** Frames the window expected that were never written. Never negative. */
  missing: number;
  /** '96 of 96' — written against expected, so a reader sees the denominator. */
  writtenLabel: string;
  /** ISO minute of the oldest unhealed close, or '—'. */
  oldestUnhealedLabel: string;
  state: FrameState;
}

/**
 * Worst first. `missing` outranks `unhealed` because a frame that was never written is a pass
 * that did not run, and no amount of healing produces it.
 */
export type FrameState = 'missing' | 'unhealed' | 'explained' | 'ok';

function state(row: WebFrameCoverage, missing: number): FrameState {
  if (missing > 0) return 'missing';
  if (row.unhealed > 0) return 'unhealed';
  if (row.explainedOnly > 0) return 'explained';
  return 'ok';
}

const RANK: Readonly<Record<FrameState, number>> = { missing: 0, unhealed: 1, explained: 2, ok: 3 };

export function toFrameViews(rows: readonly WebFrameCoverage[]): FrameView[] {
  return rows
    .map((row) => {
      // Clamped at zero: more frames than expected is not a negative gap. It happens at a
      // window edge, where a close can land inside the window after `expected` was computed.
      const missing = Math.max(0, row.expected - row.written);
      return {
        ...row,
        missing,
        writtenLabel: `${row.written} of ${row.expected}`,
        oldestUnhealedLabel: row.oldestUnhealed === null
          ? '—'
          : new Date(row.oldestUnhealed).toISOString().slice(0, 16).replace('T', ' '),
        state: state(row, missing),
      };
    })
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.tf.localeCompare(b.tf));
}

/**
 * The one number the block exists to surface, and whether anything at all has been written.
 *
 * `unhealed` is summed across timeframes because it is a work queue, not a rate — averaging it
 * would hide a 4h timeframe in trouble behind a healthy 15m one.
 */
export function frameTotals(rows: readonly WebFrameCoverage[]): {
  timeframes: number;
  written: number;
  expected: number;
  unhealed: number;
  missing: number;
} {
  return {
    timeframes: rows.length,
    written: rows.reduce((sum, r) => sum + r.written, 0),
    expected: rows.reduce((sum, r) => sum + r.expected, 0),
    unhealed: rows.reduce((sum, r) => sum + r.unhealed, 0),
    missing: rows.reduce((sum, r) => sum + Math.max(0, r.expected - r.written), 0),
  };
}
