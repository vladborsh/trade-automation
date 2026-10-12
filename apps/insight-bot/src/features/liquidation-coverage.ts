import { STREAM_LIQUIDATION as BINANCE_LIQUIDATION } from '../collectors/binance-perp/perp-collector';
import { STREAM_LIQUIDATION as BYBIT_LIQUIDATION } from '../collectors/bybit/bybit-collector';
import { STREAM_LIQUIDATION as OKX_LIQUIDATION } from '../collectors/okx/okx-collector';
import type { Heartbeat } from '../collectors/uptime/uptime-gap';

/**
 * IB-015 — which hours of the liquidation tape we were actually listening to, and the refusal
 * when we do not know.
 *
 * **Why this exists.** `liq.*.z60m` scores an hour against the symbol's own trailing hours. The
 * first version built that sample by filling every hour of the lookback with its sum or, when
 * there was no row, with zero — and published `liq.long.z60m = 3.91` beside
 * `liq.long.60m = no_data`, because ~340 hours from before collection even started had been
 * padded in as calm. A confident number manufactured entirely out of absence.
 *
 * Starting the sample at the first stored liquidation removes those 340. **It does not fix the
 * defect, it makes it quieter** (the Tech Lead, 2026-10-12): an outage *after* collection
 * started still pads its hours with zeros, and an hour nobody was listening to is not a quiet
 * hour. The sample then has a fat false-calm tail, every real hour scores high, and the number
 * still looks authoritative.
 *
 * So coverage decides, which is IB-038's three-state ruling applied here: divide by covered
 * hours where coverage is recorded, and **refuse where it is not** — never assume. The
 * `collector_heartbeats` and `collector_gaps` rows exist for exactly this question.
 *
 * **An hour counts only if EVERY liquidation stream was live for all of it.** The sums are
 * market-wide across venues, so an hour with one venue dark is a real number that is
 * understated, which is worse than a missing one: it enters the sample as a low reading and
 * drags the mean down. Conservative on purpose — a partially covered hour is dropped, not
 * counted.
 */

export const LIQUIDATION_STREAMS: readonly string[] = [
  BINANCE_LIQUIDATION,
  BYBIT_LIQUIDATION,
  OKX_LIQUIDATION,
];

const HOUR = 3_600_000;

export interface GapInterval {
  stream: string;
  gapFrom: Date;
  gapTo: Date;
}

/**
 * The three states of IB-038's ruling, for one window.
 *
 * `not_recorded` covers two different ways of not knowing, and both are genuinely "we cannot
 * say": no liquidation stream has ever reported, OR the window predates the instrumentation.
 * The second is not hypothetical — `collector_heartbeats` arrived in migration 010 on
 * 2026-10-12 while the liquidation rows reach back to 2026-09-28, so every hour in between has
 * data and no coverage record. Calling that `uncovered` would assert a gap row exists saying we
 * were down, which is evidence we do not have and would mark two weeks of real liquidations as
 * evidenced absence.
 */
export type LiquidationCoverageState = 'covered' | 'uncovered' | 'not_recorded';

export interface LiquidationCoverage {
  /**
   * False when NO liquidation stream has ever reported liveness.
   *
   * Not the same as "zero hours covered", and the distinction is the whole of IB-BUG-010: a
   * stream with no heartbeat is *not instrumented*, and treating that as "nothing was collected"
   * would refuse keys on a collector that was in fact running fine. Everything built on this
   * refuses instead of guessing, in either direction.
   */
  recorded: boolean;
  /** Was every liquidation stream live for the whole of the hour opening at `hourStartMs`? */
  isHourCovered(hourStartMs: number): boolean;
  /** Was every stream live across an arbitrary window — used for the hour being scored. */
  isWindowCovered(fromMs: number, toMsExclusive: number): boolean;
  /** Which of the three states the window is in, for choosing the refusal reason. */
  stateFor(fromMs: number, toMsExclusive: number): LiquidationCoverageState;
}

/**
 * Pure: heartbeats and gap rows in, a coverage oracle out.
 *
 * `streams` should already be filtered to the liquidation streams; `LIQUIDATION_STREAMS` names
 * them. A stream present in `streams` but with no gaps is live for its whole
 * `[firstSeenAt, lastSeenAt]` span.
 */
export function liquidationCoverage(
  streams: readonly Heartbeat[],
  gaps: readonly GapInterval[],
): LiquidationCoverage {
  const relevant = streams.filter((s) => LIQUIDATION_STREAMS.includes(s.stream));
  const recorded = relevant.length > 0;

  const gapsByStream = new Map<string, GapInterval[]>();
  for (const gap of gaps) {
    if (!LIQUIDATION_STREAMS.includes(gap.stream)) continue;
    const list = gapsByStream.get(gap.stream) ?? [];
    list.push(gap);
    gapsByStream.set(gap.stream, list);
  }

  const stateFor = (fromMs: number, toMsExclusive: number): LiquidationCoverageState => {
    if (!recorded) return 'not_recorded';

    // Before the instrumentation existed we have no record either way — NOT an evidenced
    // absence. Checked first, because it is the weaker claim and the one that must win: saying
    // "we were down" about a period we simply were not measuring is the same class of error as
    // the padded zeros this module replaced.
    for (const beat of relevant) {
      if (beat.firstSeenAt.getTime() > fromMs) return 'not_recorded';
    }

    for (const beat of relevant) {
      // Past the last heartbeat the stream had stopped reporting. Liveness is written every
      // 30 s while running, so this really is "it went away", not "we stopped looking".
      if (beat.lastSeenAt.getTime() < toMsExclusive) return 'uncovered';
      for (const gap of gapsByStream.get(beat.stream) ?? []) {
        // any overlap at all disqualifies the window — half an hour of listening is not an hour
        if (gap.gapFrom.getTime() < toMsExclusive && gap.gapTo.getTime() > fromMs) return 'uncovered';
      }
    }
    return 'covered';
  };

  const covered = (fromMs: number, toMsExclusive: number) => stateFor(fromMs, toMsExclusive) === 'covered';

  return {
    recorded,
    isHourCovered: (hourStartMs: number) => covered(hourStartMs, hourStartMs + HOUR),
    isWindowCovered: covered,
    stateFor,
  };
}

/**
 * The hour-start instants in `[fromMs, toMsExclusive)` that are fully covered, oldest first.
 *
 * These are the only hours allowed into a z-score's sample. Within them a missing bucket is a
 * genuine zero — we were listening and nothing was liquidated — which is a real observation and
 * must stay in, or the sample becomes a sample of busy hours only and every busy hour looks
 * normal against it.
 */
export function coveredHourStarts(
  coverage: LiquidationCoverage,
  fromMs: number,
  toMsExclusive: number,
): number[] {
  if (!coverage.recorded) return [];
  const out: number[] = [];
  const first = Math.ceil(fromMs / HOUR) * HOUR;
  for (let at = first; at + HOUR <= toMsExclusive; at += HOUR) {
    if (coverage.isHourCovered(at)) out.push(at);
  }
  return out;
}
