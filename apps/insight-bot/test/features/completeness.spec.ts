import {
  assessCompleteness, attemptSchedule, canArm, GRACE_MS, isFinalAttempt, RECHECK_OFFSETS_MS,
  type BucketState,
} from '../../src/features/completeness';

/**
 * IB-015 / §16.10 — the refusal path, specced as carefully as the happy one.
 *
 * The thing these tests defend: a frame is not a chart. A chart drawn on a short bar is ugly; a
 * frame computed on a short bar can arm a playbook on a number that was never true. So every
 * way of arriving at "incomplete" has its own test, and the last describe block is the one that
 * must never be deleted.
 */

const CLOSE = Date.UTC(2026, 8, 28, 12, 0, 0);
const M15 = 900_000;

const bucket = (openTime: number, complete = true): BucketState => ({ openTime, complete });

/** The closing bucket plus three earlier ones, all complete. */
const window = (over: BucketState[] = []): BucketState[] => {
  const base = [bucket(CLOSE - 3 * M15), bucket(CLOSE - 2 * M15), bucket(CLOSE - M15), bucket(CLOSE)];
  return base.map((b) => over.find((o) => o.openTime === b.openTime) ?? b);
};

describe('assessCompleteness — the happy path', () => {
  it('is complete when every bucket in the window and the OI slot are there', () => {
    expect(assessCompleteness({ closeTime: CLOSE, buckets: window(), oiSlotPresent: true }))
      .toEqual({ complete: true });
  });
});

describe('assessCompleteness — every way of refusing', () => {
  it('refuses when the CLOSING bucket is short', () => {
    expect(assessCompleteness({ closeTime: CLOSE, buckets: window([bucket(CLOSE, false)]), oiSlotPresent: true }))
      .toEqual({ complete: false, reason: 'closing_bucket_incomplete', incompleteAt: [CLOSE] });
  });

  it('refuses when the closing bucket does not exist yet — nothing derived, not "complete"', () => {
    const withoutClose = window().filter((b) => b.openTime !== CLOSE);
    expect(assessCompleteness({ closeTime: CLOSE, buckets: withoutClose, oiSlotPresent: true }))
      .toEqual({ complete: false, reason: 'closing_bucket_missing', incompleteAt: [CLOSE] });
  });

  it('refuses when a bucket INSIDE the window is short, even though the close is fine', () => {
    // an ATR or a CVD window reaching over a short bar is computed on less input than it claims
    const result = assessCompleteness({
      closeTime: CLOSE, buckets: window([bucket(CLOSE - 2 * M15, false)]), oiSlotPresent: true,
    });
    expect(result).toEqual({
      complete: false, reason: 'window_bucket_incomplete', incompleteAt: [CLOSE - 2 * M15],
    });
  });

  it('refuses when the OI slot is missing', () => {
    expect(assessCompleteness({ closeTime: CLOSE, buckets: window(), oiSlotPresent: false }))
      .toEqual({ complete: false, reason: 'oi_slot_missing', incompleteAt: [CLOSE] });
  });

  it('reports the CLOSING bucket before an older one — the live problem first', () => {
    const result = assessCompleteness({
      closeTime: CLOSE,
      buckets: window([bucket(CLOSE, false), bucket(CLOSE - 3 * M15, false)]),
      oiSlotPresent: true,
    });
    expect(result).toMatchObject({ reason: 'closing_bucket_incomplete' });
  });

  it('lists every short bucket in the window, oldest first, so one repair fixes all of them', () => {
    const result = assessCompleteness({
      closeTime: CLOSE,
      buckets: window([bucket(CLOSE - M15, false), bucket(CLOSE - 3 * M15, false)]),
      oiSlotPresent: true,
    });
    expect(result).toEqual({
      complete: false, reason: 'window_bucket_incomplete',
      incompleteAt: [CLOSE - 3 * M15, CLOSE - M15],
    });
  });

  it('a short bar outranks a missing OI slot — the bar is the worse input', () => {
    const result = assessCompleteness({
      closeTime: CLOSE, buckets: window([bucket(CLOSE, false)]), oiSlotPresent: false,
    });
    expect(result).toMatchObject({ reason: 'closing_bucket_incomplete' });
  });
});

describe('the retry schedule (§16.10: grace, then +30 s and +60 s)', () => {
  it('looks three times and then stops', () => {
    expect(attemptSchedule(CLOSE)).toEqual([
      CLOSE + GRACE_MS,
      CLOSE + GRACE_MS + 30_000,
      CLOSE + GRACE_MS + 60_000,
    ]);
    expect(RECHECK_OFFSETS_MS).toEqual([30_000, 60_000]);
  });

  it('knows which attempt is the last, after which the incomplete frame is written', () => {
    // it must NOT spin waiting for a heal: IB-014's heal pass triggers the recompute instead
    expect(isFinalAttempt(0)).toBe(false);
    expect(isFinalAttempt(1)).toBe(false);
    expect(isFinalAttempt(2)).toBe(true);
    expect(attemptSchedule(CLOSE)).toHaveLength(RECHECK_OFFSETS_MS.length + 1);
  });
});

/**
 * The rule the whole task hangs on. If someone later "optimises" the engine, this is the test
 * that should stop them.
 */
describe('§16.10: an incomplete frame can NEVER arm or trigger', () => {
  it('canArm is false for an incomplete frame, whatever else it carries', () => {
    expect(canArm({ complete: false })).toBe(false);
  });

  it('canArm is true only for a complete one', () => {
    expect(canArm({ complete: true })).toBe(true);
  });

  it('there is no argument, flag or override that makes an incomplete frame armable', () => {
    // canArm takes the frame and nothing else on purpose: no force, no "best effort" path.
    expect(canArm.length).toBe(1);
    for (const extra of [{ complete: false, force: true }, { complete: false, urgent: true }]) {
      expect(canArm(extra as { complete: boolean })).toBe(false);
    }
  });
});
