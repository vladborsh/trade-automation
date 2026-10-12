import type { WebCollectorCoverage } from '@trade-automation/contracts';

/**
 * IB-BUG-010 — pure display helpers for the collector-uptime half of the coverage page (AGENTS.md:
 * anything that can be a pure function lives beside the component with its own spec).
 *
 * The page's job here is to make a denominator visible. "No liquidation in this hour" and "nobody
 * was listening in this hour" are the same absence in the data, and a statistic that cannot tell
 * them apart reads downtime as a quiet market — measured on `insight_coord`, 9 of 226 hours hold
 * any liquidation at all, so a ratio over elapsed time is understated 25-fold.
 */

export interface CollectorView extends WebCollectorCoverage {
  /** '41%' — or '—' when there is no elapsed time to be a fraction of. */
  coveredLabel: string;
  /** The covered fraction, 0..1, or null when `elapsedHours` is 0. */
  coveredFraction: number | null;
  /** ISO day of first liveness, so a reader can see how short the basis is. */
  firstSeenLabel: string;
  state: CollectorState;
}

export type CollectorState = 'complete' | 'holes' | 'empty';

/**
 * Display thresholds, not venue facts: 99 % and 90 % are where a reader's attention should go, and
 * nothing computes off them. They are deliberately not tight — a heartbeat is written every 30 s
 * and a restart inside the noise floor writes no gap at all, so a healthy collector reads at or
 * very near 100 %.
 */
const COMPLETE_AT = 0.99;
const HOLES_AT = 0.9;

function state(fraction: number | null): CollectorState {
  if (fraction === null) return 'empty';
  if (fraction >= COMPLETE_AT) return 'complete';
  if (fraction >= HOLES_AT) return 'holes';
  return 'empty';
}

export function toCollectorViews(rows: readonly WebCollectorCoverage[]): CollectorView[] {
  return rows
    .map((row) => {
      // never divide by a zero elapsed window: a stream registered this second has no fraction yet,
      // and '0%' would read as an outage rather than as "too early to say"
      const fraction = row.elapsedHours > 0 ? row.coveredHours / row.elapsedHours : null;
      return {
        ...row,
        coveredFraction: fraction,
        coveredLabel: fraction === null ? '—' : `${Math.round(fraction * 100)}%`,
        firstSeenLabel: row.firstSeen === null ? '—' : new Date(row.firstSeen).toISOString().slice(0, 10),
        state: state(fraction),
      };
    })
    // worst first: the row a reader needs is the one that is missing hours
    .sort((a, b) => (a.coveredFraction ?? 2) - (b.coveredFraction ?? 2));
}

/**
 * IB-044 — whether the page has a basis to state at all.
 *
 * The bug this fixes: a collector that predates IB-BUG-010 writes its first heartbeat at startup,
 * so `first_seen_at` is "now" and the window it has been responsible for is zero wide. The totals
 * were then rendered as «покрыто 0 из 0 часов» — nothing, stated as a measurement. **Zero covered
 * out of zero elapsed is not 0 % coverage; it is the absence of a basis**, and the two must not
 * share a sentence. This is the aggregate form of the per-stream rule already in
 * `toCollectorViews`, where a stream with no elapsed time shows '—' rather than '0%'.
 *
 * Note what is deliberately NOT folded in here: a stream with elapsed hours and **zero covered**
 * stays `recorded`. "We were responsible for 24 hours and covered none" is a real and alarming
 * measurement, and collapsing it into "not recorded" would hide an outage behind the words used
 * for "we never looked".
 *
 * The third state in IB-038's ruling — *no events* — is not decidable here. It is a statement
 * about the tape (we were listening and nothing was liquidated), and this endpoint carries no
 * event counts. Inventing it from coverage alone would be the inference IB-BUG-010 exists to
 * forbid, so it belongs to the consumer that has the numerator.
 */
export type BasisState = 'recorded' | 'not-recorded';

export function basisState(totals: { streams: number; elapsedHours: number }): BasisState {
  if (totals.streams === 0) return 'not-recorded';
  if (totals.elapsedHours <= 0) return 'not-recorded';
  return 'recorded';
}

/**
 * The covered and elapsed totals across streams, for the page's one-line basis.
 *
 * Both are summed rather than averaged: a ratio of the two answers "what fraction of the
 * collector-hours we were responsible for did we actually collect", which is the figure a
 * statistic's basis cares about. Averaging percentages would let a stream that ran for an hour
 * outvote one that ran for a month.
 */
export function collectorTotals(rows: readonly WebCollectorCoverage[]): {
  streams: number;
  coveredHours: number;
  elapsedHours: number;
  outages: number;
} {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    streams: rows.length,
    coveredHours: round(rows.reduce((sum, r) => sum + r.coveredHours, 0)),
    elapsedHours: round(rows.reduce((sum, r) => sum + r.elapsedHours, 0)),
    outages: rows.reduce((sum, r) => sum + r.outages, 0),
  };
}
