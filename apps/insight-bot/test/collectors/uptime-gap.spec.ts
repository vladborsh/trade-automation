import { coveredMs, uptimeGap, type Heartbeat } from '../../src/collectors/uptime/uptime-gap';

/**
 * IB-BUG-010 — the uncovered window, and the hours a statistic may divide by.
 *
 * The bar set for this task was "a spec that can fail": a test asserting only that *a row was
 * written* would have passed on IB-BUG-011's code too, which wrote a confident wrong number. So
 * every test here asserts the **window** or the **arithmetic**, and the fixtures are built to
 * disagree with the implementation — the stop and the restart are different instants from the
 * window boundaries, the gaps overlap each other, and one gap starts before the window.
 */

const T = (iso: string) => new Date(iso);
const HOUR = 3_600_000;
const STALE = 120_000;

const beat = (over: Partial<Heartbeat> = {}): Heartbeat => ({
  stream: 'bybit:allLiquidation',
  venue: 'bybit',
  market: 'perp',
  firstSeenAt: T('2026-09-28T00:00:00Z'),
  lastSeenAt: T('2026-09-28T10:00:00Z'),
  ...over,
});

describe('a collector that stopped and restarted', () => {
  it('produces a row whose window is the one that was NOT covered', () => {
    // stopped at 10:00 (last liveness), came back at 18:30. The row must be 10:00 → 18:30, and
    // the deliberately odd restart minute is there so a hard-coded or rounded window fails.
    const row = uptimeGap({
      stream: 'bybit:allLiquidation',
      venue: 'bybit',
      market: 'perp',
      heartbeat: beat({ lastSeenAt: T('2026-09-28T10:00:00Z') }),
      now: T('2026-09-28T18:30:00Z'),
      staleAfterMs: STALE,
    })!;

    expect(row.gapFrom.toISOString()).toBe('2026-09-28T10:00:00.000Z');
    expect(row.gapTo.toISOString()).toBe('2026-09-28T18:30:00.000Z');
    // the window is the outage, not the run: 8.5 hours
    expect(row.gapTo.getTime() - row.gapFrom.getTime()).toBe(8.5 * HOUR);
  });

  it('follows the shape the Binance rows on the tape already use', () => {
    const row = uptimeGap({
      stream: 'okx:liquidation-orders', venue: 'okx', market: 'perp',
      heartbeat: beat({ lastSeenAt: T('2026-09-28T10:00:00Z') }),
      now: T('2026-09-28T12:00:00Z'), staleAfterMs: STALE,
    })!;

    // measured against the two real binance-perp:forceOrder rows in insight_dev3 on 2026-10-12:
    // symbol null (all-symbols stream), expected 0 and repaired 0 (no REST equivalent, so nothing
    // could ever be recovered), detected_at == gap_to (the row is written when the spell ends)
    expect(row.symbol).toBeNull();
    expect(row.expected).toBe(0);
    expect(row.repaired).toBe(0);
    expect(row.detectedAt.getTime()).toBe(row.gapTo.getTime());
    expect(row.venue).toBe('okx');
    // the reason is in the row, so a reader of the table knows why without reading the code
    expect(row.error).toContain('collector not running');
    expect(row.error).toContain('7200s');
  });

  it('writes NOTHING when the stream has never run — absence of a gap is not a claim of coverage', () => {
    // the trap: emitting a gap here would assert we were responsible for every hour since the
    // epoch, which is how you get a coverage figure that is confidently wrong in our favour
    expect(uptimeGap({
      stream: 'bybit:allLiquidation', venue: 'bybit', market: 'perp',
      heartbeat: null, now: T('2026-09-28T18:30:00Z'), staleAfterMs: STALE,
    })).toBeNull();
  });

  it('writes nothing for a restart inside the noise floor', () => {
    // 90s < 120s: an ordinary redeploy, not an outage. Without this, every restart leaves a row
    // and the real multi-hour spells get lost among them.
    expect(uptimeGap({
      stream: 'bybit:allLiquidation', venue: 'bybit', market: 'perp',
      heartbeat: beat({ lastSeenAt: T('2026-09-28T10:00:00Z') }),
      now: T('2026-09-28T10:01:30Z'), staleAfterMs: STALE,
    })).toBeNull();
  });

  it('writes nothing when the clock went backwards', () => {
    // gap_from > gap_to sums to a negative duration and would silently inflate covered hours
    expect(uptimeGap({
      stream: 'bybit:allLiquidation', venue: 'bybit', market: 'perp',
      heartbeat: beat({ lastSeenAt: T('2026-09-28T10:00:00Z') }),
      now: T('2026-09-28T09:00:00Z'), staleAfterMs: STALE,
    })).toBeNull();
  });
});

describe('covered hours, which is what a statistic divides by', () => {
  const window = { from: T('2026-09-28T00:00:00Z'), to: T('2026-09-29T00:00:00Z') }; // 24 h
  const existedAll = T('2026-09-01T00:00:00Z');

  it('subtracts an outage from elapsed time', () => {
    const covered = coveredMs(window, [
      { gapFrom: T('2026-09-28T10:00:00Z'), gapTo: T('2026-09-28T18:00:00Z') }, // 8 h
    ], existedAll);
    expect(covered).toBe(16 * HOUR);
  });

  it('is elapsed time when there was no outage', () => {
    expect(coveredMs(window, [], existedAll)).toBe(24 * HOUR);
  });

  it('clips a gap that began before the window instead of over-subtracting', () => {
    // 6 h before the window + 3 h inside it. Only the 3 h inside may be subtracted; a naive
    // implementation subtracts 9 and reports 15.
    const covered = coveredMs(window, [
      { gapFrom: T('2026-09-27T18:00:00Z'), gapTo: T('2026-09-28T03:00:00Z') },
    ], existedAll);
    expect(covered).toBe(21 * HOUR);
  });

  it('merges two streams down over the same hours instead of subtracting it twice', () => {
    // bybit down 10:00–18:00, okx down 14:00–20:00. The uncovered span is 10:00–20:00 = 10 h, not
    // 8 + 6 = 14 h. Un-merged arithmetic gives 10 h covered here, and on a longer outage it goes
    // negative — which is how you notice, if you are lucky.
    const covered = coveredMs(window, [
      { gapFrom: T('2026-09-28T10:00:00Z'), gapTo: T('2026-09-28T18:00:00Z') },
      { gapFrom: T('2026-09-28T14:00:00Z'), gapTo: T('2026-09-28T20:00:00Z') },
    ], existedAll);
    expect(covered).toBe(14 * HOUR);
  });

  it('merges adjacent gaps and keeps disjoint ones apart', () => {
    const covered = coveredMs(window, [
      { gapFrom: T('2026-09-28T01:00:00Z'), gapTo: T('2026-09-28T02:00:00Z') },
      { gapFrom: T('2026-09-28T02:00:00Z'), gapTo: T('2026-09-28T03:00:00Z') }, // touching
      { gapFrom: T('2026-09-28T20:00:00Z'), gapTo: T('2026-09-28T21:00:00Z') }, // separate
    ], existedAll);
    expect(covered).toBe(21 * HOUR);
  });

  it('does not count time before the collector first existed as covered', () => {
    // we started at noon, so at most 12 h of this day can be claimed — this is the property that
    // stops a brand-new database reporting "100 % covered" for all of history
    expect(coveredMs(window, [], T('2026-09-28T12:00:00Z'))).toBe(12 * HOUR);
  });

  it('claims nothing when the collector has never run at all', () => {
    expect(coveredMs(window, [], null)).toBe(0);
  });

  it('reproduces the measured insight_coord shape: 9 covered hours out of 226 elapsed', () => {
    // the figure in the brief, as arithmetic rather than as a sentence. 226 h elapsed with a single
    // 217 h outage leaves 9 h covered, and a ratio computed on 226 is understated 25-fold.
    const from = T('2026-09-28T00:00:00Z');
    const to = new Date(from.getTime() + 226 * HOUR);
    const covered = coveredMs({ from, to }, [
      { gapFrom: new Date(from.getTime() + 9 * HOUR), gapTo: to },
    ], from);
    expect(covered).toBe(9 * HOUR);
    expect(covered / (226 * HOUR)).toBeCloseTo(0.0398, 4);
  });
});
