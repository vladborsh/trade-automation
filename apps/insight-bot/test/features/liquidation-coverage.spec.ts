import type { Heartbeat } from '../../src/collectors/uptime/uptime-gap';
import {
  LIQUIDATION_STREAMS, coveredHourStarts, liquidationCoverage,
} from '../../src/features/liquidation-coverage';

/**
 * IB-015 — which hours of the liquidation tape we were listening to.
 *
 * The defect these assertions exist for: a z-score sample built by padding every hour of a
 * 30-day lookback with zero published `liq.long.z60m = 3.91` next to `liq.long.60m = no_data`.
 * Starting the sample at the first stored row removed the loud half. This is the quiet half —
 * an outage AFTER collection started, whose hours are just as fabricated and far harder to see.
 */
const H = 3_600_000;
const at = (h: number, m = 0) => Date.UTC(2026, 9, 12, h, m);

const beat = (stream: string, firstSeen: number, lastSeen: number): Heartbeat => ({
  stream, venue: stream.split(':')[0] as string, market: null,
  firstSeenAt: new Date(firstSeen), lastSeenAt: new Date(lastSeen),
});

/** All three streams live across the whole day. */
const allLive = () => LIQUIDATION_STREAMS.map((s) => beat(s, at(0), at(24)));

describe('liquidationCoverage', () => {
  it('is NOT RECORDED when no liquidation stream has ever reported', () => {
    // Distinct from "covered zero hours" — IB-BUG-010. A stream with no heartbeat is not
    // instrumented, and the caller refuses rather than deciding either way.
    const coverage = liquidationCoverage([], []);
    expect(coverage.recorded).toBe(false);
    expect(coverage.isHourCovered(at(12))).toBe(false);
  });

  it('ignores heartbeats from streams that are not liquidation streams', () => {
    const coverage = liquidationCoverage([beat('binance-perp:kline_1m', at(0), at(24))], []);
    expect(coverage.recorded).toBe(false);
  });

  it('covers an hour when every stream was live for all of it', () => {
    expect(liquidationCoverage(allLive(), []).isHourCovered(at(12))).toBe(true);
  });

  it('REFUSES an hour when a SINGLE venue was down for part of it', () => {
    // The sums are market-wide. An hour with one venue dark is understated, not missing — it
    // enters the sample as a low reading and drags the mean down, which is the «все биржи»
    // error inside one number instead of under a label.
    const gaps = [{ stream: LIQUIDATION_STREAMS[1] as string, gapFrom: new Date(at(12, 10)), gapTo: new Date(at(12, 20)) }];
    const coverage = liquidationCoverage(allLive(), gaps);
    expect(coverage.isHourCovered(at(12))).toBe(false);
    expect(coverage.isHourCovered(at(13))).toBe(true); // the neighbour is untouched
  });

  it('refuses an hour that is even one minute inside a gap', () => {
    // Half an hour of listening is not an hour. Any overlap disqualifies.
    const gaps = [{ stream: LIQUIDATION_STREAMS[0] as string, gapFrom: new Date(at(12, 59)), gapTo: new Date(at(13, 1)) }];
    const coverage = liquidationCoverage(allLive(), gaps);
    expect(coverage.isHourCovered(at(12))).toBe(false);
    expect(coverage.isHourCovered(at(13))).toBe(false);
    expect(coverage.isHourCovered(at(11))).toBe(true);
  });

  it('refuses hours before a stream first ran, even with no gap row', () => {
    // There is no gap row for "we did not exist yet", so firstSeenAt has to be honoured
    // directly or the whole pre-history reads as covered and calm.
    const beats = [
      beat(LIQUIDATION_STREAMS[0] as string, at(0), at(24)),
      beat(LIQUIDATION_STREAMS[1] as string, at(10), at(24)),
      beat(LIQUIDATION_STREAMS[2] as string, at(0), at(24)),
    ];
    const coverage = liquidationCoverage(beats, []);
    expect(coverage.isHourCovered(at(9))).toBe(false);
    expect(coverage.isHourCovered(at(10))).toBe(true);
  });

  it('refuses hours after a stream was last seen', () => {
    const beats = LIQUIDATION_STREAMS.map((s, i) => beat(s, at(0), i === 2 ? at(14) : at(24)));
    const coverage = liquidationCoverage(beats, []);
    expect(coverage.isHourCovered(at(13))).toBe(true);
    expect(coverage.isHourCovered(at(14))).toBe(false);
  });

  it('answers an arbitrary window, for the hour being scored', () => {
    const gaps = [{ stream: LIQUIDATION_STREAMS[0] as string, gapFrom: new Date(at(12, 5)), gapTo: new Date(at(12, 6)) }];
    const coverage = liquidationCoverage(allLive(), gaps);
    expect(coverage.isWindowCovered(at(11), at(12))).toBe(true);
    expect(coverage.isWindowCovered(at(12), at(13))).toBe(false);
  });
});

describe('coveredHourStarts', () => {
  it('returns only the covered hours, so an outage leaves a HOLE rather than zeros', () => {
    // This is the whole fix. The padding version turned these three hours into three calm
    // observations; now they are simply absent from the sample.
    const gaps = [{ stream: LIQUIDATION_STREAMS[0] as string, gapFrom: new Date(at(3)), gapTo: new Date(at(6)) }];
    const hours = coveredHourStarts(liquidationCoverage(allLive(), gaps), at(0), at(8));
    expect(hours).toEqual([at(0), at(1), at(2), at(6), at(7)]);
  });

  it('is empty when coverage was never recorded — nothing to build a sample from', () => {
    expect(coveredHourStarts(liquidationCoverage([], []), at(0), at(8))).toEqual([]);
  });

  it('excludes a trailing partial hour rather than counting it short', () => {
    expect(coveredHourStarts(liquidationCoverage(allLive(), []), at(0), at(2, 30)))
      .toEqual([at(0), at(1)]);
  });

  it('aligns to the hour, so a window starting mid-hour does not shift every bucket', () => {
    // Buckets are epoch-anchored everywhere else in the app; a sample whose hours were offset
    // by 20 minutes would silently score against the wrong windows.
    expect(coveredHourStarts(liquidationCoverage(allLive(), []), at(0, 20), at(3)))
      .toEqual([at(1), at(2)]);
  });

  it('counts the hours it keeps, so 14 days of coverage is a real floor', () => {
    const hours = coveredHourStarts(liquidationCoverage(allLive(), []), at(0), at(24));
    expect(hours).toHaveLength(24);
  });
});

/**
 * The three states, and the distinction that matters most: not knowing is not the same as
 * knowing we were down.
 */
describe('stateFor', () => {
  it('is not_recorded for a window BEFORE the instrumentation existed', () => {
    // Not hypothetical: `collector_heartbeats` arrived in migration 010 on 2026-10-12 while the
    // liquidation rows reach back to 2026-09-28. Calling those two weeks `uncovered` would
    // assert a gap row exists saying we were down, and mark real liquidations as evidenced
    // absence — the same overclaim as the padded zeros, pointing the other way.
    const beats = LIQUIDATION_STREAMS.map((s) => beat(s, at(12), at(24)));
    const coverage = liquidationCoverage(beats, []);
    expect(coverage.stateFor(at(8), at(9))).toBe('not_recorded');
    expect(coverage.stateFor(at(13), at(14))).toBe('covered');
  });

  it('is uncovered — evidenced — only inside the instrumented span', () => {
    const gaps = [{ stream: LIQUIDATION_STREAMS[0] as string, gapFrom: new Date(at(13)), gapTo: new Date(at(14)) }];
    expect(liquidationCoverage(allLive(), gaps).stateFor(at(13), at(14))).toBe('uncovered');
  });

  it('prefers not_recorded over uncovered when both could apply', () => {
    // A window that is both before one stream's first heartbeat and inside another's gap is
    // still "we cannot say": the weaker claim wins, because the stronger one is unprovable.
    const beats = [
      beat(LIQUIDATION_STREAMS[0] as string, at(12), at(24)),
      beat(LIQUIDATION_STREAMS[1] as string, at(0), at(24)),
      beat(LIQUIDATION_STREAMS[2] as string, at(0), at(24)),
    ];
    const gaps = [{ stream: LIQUIDATION_STREAMS[1] as string, gapFrom: new Date(at(8)), gapTo: new Date(at(9)) }];
    expect(liquidationCoverage(beats, gaps).stateFor(at(8), at(9))).toBe('not_recorded');
  });

  it('is not_recorded when nothing is instrumented at all', () => {
    expect(liquidationCoverage([], []).stateFor(at(12), at(13))).toBe('not_recorded');
  });
});
