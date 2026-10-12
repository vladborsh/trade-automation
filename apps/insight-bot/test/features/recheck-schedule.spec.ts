import {
  TIMEFRAME_MS, attemptsForClose, isAttemptStillDue, lastCloseMs, nextAttempt,
} from '../../src/features/recheck-schedule';

/**
 * IB-015 §8.1 — the pass's schedule.
 *
 * Every instant is derived from the epoch rather than from the previous tick. The bug this
 * prevents is slow and invisible: a boundary computed from the last boundary accumulates drift
 * until frames are stamped with closes they do not belong to.
 */
const H = 3_600_000;
const M = 60_000;
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 12, h, m, s);

describe('lastCloseMs', () => {
  it('floors to the bar, never to the clock', () => {
    expect(lastCloseMs('15m', at(12, 7, 30))).toBe(at(12, 0));
    expect(lastCloseMs('15m', at(12, 15, 0))).toBe(at(12, 15));
    expect(lastCloseMs('4h', at(13, 59))).toBe(at(12, 0));
  });

  it('is epoch-anchored, so it does not drift with the process', () => {
    // The same instant always yields the same close, whatever happened before it.
    const instant = at(9, 44, 59);
    expect(lastCloseMs('15m', instant)).toBe(lastCloseMs('15m', instant));
    expect(lastCloseMs('15m', instant)).toBe(at(9, 30));
  });
});

describe('attemptsForClose', () => {
  it('is the grace then the two re-checks, in order', () => {
    const attempts = attemptsForClose('15m', at(12, 0));
    expect(attempts.map((a) => a.atMs - at(12, 0))).toEqual([15_000, 30_000, 60_000]);
    expect(attempts.map((a) => a.attempt)).toEqual([0, 1, 2]);
  });

  it('stamps every attempt with the BAR, not with when it runs', () => {
    // The frame a late re-check writes still belongs to the bar that closed, which is what a
    // signal referencing it means by "the 12:00 frame".
    for (const a of attemptsForClose('4h', at(12, 0))) expect(a.closeMs).toBe(at(12, 0));
  });
});

describe('nextAttempt', () => {
  it('finds the 15m grace right after a close', () => {
    // 12:15 rather than 12:00: 12:00 is a 4h close too, and the tie-break below owns that case.
    const next = nextAttempt(at(12, 15, 1));
    expect(next.tf).toBe('15m');
    expect(next.closeMs).toBe(at(12, 15));
    expect(next.atMs).toBe(at(12, 15, 15));
  });

  it('walks the re-checks before moving to the next bar', () => {
    expect(nextAttempt(at(12, 0, 16)).atMs).toBe(at(12, 0, 30));
    expect(nextAttempt(at(12, 0, 31)).atMs).toBe(at(12, 1, 0));
    expect(nextAttempt(at(12, 1, 1)).atMs).toBe(at(12, 15, 15));
  });

  it('is always in the future, never the instant it was asked about', () => {
    // An attempt returned "now" would run in a loop: the timeout fires immediately, the pass
    // asks again, and gets the same answer.
    const now = at(12, 0, 15);
    expect(nextAttempt(now).atMs).toBeGreaterThan(now);
  });

  it('gives the 4h bar its own attempts at a shared boundary', () => {
    // 12:00 is both a 15m and a 4h close. Two frames, two rows, different `tf` — not a
    // duplicate, because a signal on the 4h frame means something different.
    const next = nextAttempt(at(12, 0, 0));
    expect(next.atMs).toBe(at(12, 0, 15));
    expect(next.tf).toBe('4h'); // ties break to the longer timeframe
    const all = [0, 1, 2].map((i) => nextAttempt(at(12, 0, 0) + i));
    expect(all.every((a) => a.atMs === at(12, 0, 15))).toBe(true);
  });

  it('crosses an hour and a day boundary without special-casing either', () => {
    expect(nextAttempt(Date.UTC(2026, 9, 12, 23, 59, 59)).atMs).toBe(Date.UTC(2026, 9, 13, 0, 0, 15));
  });
});

describe('isAttemptStillDue', () => {
  it('runs a late attempt — a frame late beats no frame at all', () => {
    const [grace] = attemptsForClose('15m', at(12, 0));
    expect(isAttemptStillDue(grace, at(12, 5))).toBe(true);
  });

  it('REFUSES an attempt whose bar has already been succeeded', () => {
    // Running the 12:00 grace at 12:20 would stamp a frame as the 12:00 bar's when the 12:15 bar
    // has closed and has its own. The process was asleep; the frame should not pretend it wasn't.
    const [grace] = attemptsForClose('15m', at(12, 0));
    expect(isAttemptStillDue(grace, at(12, 15))).toBe(false);
    expect(isAttemptStillDue(grace, at(12, 20))).toBe(false);
  });

  it('gives a 4h bar the whole 4 hours, because its successor is that far away', () => {
    const [grace] = attemptsForClose('4h', at(12, 0));
    expect(isAttemptStillDue(grace, at(15, 59))).toBe(true);
    expect(isAttemptStillDue(grace, at(16, 0))).toBe(false);
  });
});

describe('TIMEFRAME_MS', () => {
  it('agrees with the arithmetic the rest of the pass does', () => {
    expect(TIMEFRAME_MS['15m']).toBe(15 * M);
    expect(TIMEFRAME_MS['4h']).toBe(4 * H);
  });
});
