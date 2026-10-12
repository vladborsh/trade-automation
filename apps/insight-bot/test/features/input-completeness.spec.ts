import { WEB_FEATURE_PERMANENT_REASONS, isPermanentRefusal } from '@trade-automation/contracts';
import {
  HEAL_LOOKBACK_MS, NO_EVIDENCE, assessWindows, expectedMinutes, reasonForShortfall,
  type WindowShortfall,
} from '../../src/features/input-completeness';
import { HEAL_LOOKBACK_MS as DERIVE_LOOKBACK } from '../../src/derive/derive.service';

/**
 * IB-015 — a shortfall is only worth chasing when something could still fix it. The condition
 * here is the Tech Lead's: an absence the venue caused must not sit behind a counter that can
 * never drain.
 */

const short = (over: Partial<WindowShortfall> = {}): WindowShortfall => ({
  group: 'candles1m:perp', expected: 240, present: 238,
  detail: 'candles_1m perp 12:00-16:00, 238 of 240', ...over,
});

describe('expectedMinutes', () => {
  it('is the candles_1m completeness check CVD needs', () => {
    // Without it CVD publishes at +15 s and a late 1m row moves it at +60 s — which §8.1 calls
    // the normal case in degraded mode, so it would trip the data-defect rule routinely.
    expect(expectedMinutes(4)).toBe(240);
    expect(expectedMinutes(24)).toBe(1440);
  });
});

describe('reasonForShortfall', () => {
  it('is incomplete_input when nothing explains the missing minutes', () => {
    expect(reasonForShortfall(short(), NO_EVIDENCE)).toBe('incomplete_input');
  });

  it('IS PERMANENT when a recorded gap explains every missing minute', () => {
    // The data is gone and is already counted once in collector_gaps. Counting it again per
    // frame would double-count a known problem and light an alarm nobody can clear.
    expect(reasonForShortfall(short(), { recordedGapMinutes: 2, notTradedMinutes: 0 }))
      .toBe('explained_absence');
  });

  it('IS PERMANENT when the venue never produced the minutes', () => {
    // A halt, a maintenance window, or before the symbol listed. Not a defect at all.
    expect(reasonForShortfall(short(), { recordedGapMinutes: 0, notTradedMinutes: 2 }))
      .toBe('explained_absence');
  });

  it('accepts the two kinds of evidence together', () => {
    expect(reasonForShortfall(short({ expected: 240, present: 236 }), { recordedGapMinutes: 2, notTradedMinutes: 2 }))
      .toBe('explained_absence');
  });

  it('PARTLY EXPLAINED IS STILL UNEXPLAINED', () => {
    // Rounding a partial explanation up to "explained" would hide exactly the minutes worth
    // chasing — one missing minute nobody can account for is the finding.
    expect(reasonForShortfall(short({ expected: 240, present: 237 }), { recordedGapMinutes: 2, notTradedMinutes: 0 }))
      .toBe('incomplete_input');
  });

  it('refuses to be called for a complete window, rather than inventing a reason', () => {
    expect(() => reasonForShortfall(short({ present: 240 }))).toThrow(/complete window/);
  });

  it('every permanent reason it can return really is on the permanent list', () => {
    // The list is what decides whether the alarm rings, so the two must not drift.
    expect(WEB_FEATURE_PERMANENT_REASONS).toContain('explained_absence');
    expect(isPermanentRefusal({ ok: false, why: 'explained_absence' })).toBe(true);
    expect(isPermanentRefusal({ ok: false, why: 'incomplete_input' })).toBe(false);
  });
});

describe('assessWindows', () => {
  it('separates the groups that can still heal from the ones that cannot', () => {
    const { incompleteGroups, explainedGroups, reasons } = assessWindows(
      [short({ group: 'candles1m:perp' }), short({ group: 'candles1m:spot', detail: 'candles_1m spot halted' })],
      { 'candles1m:spot': { recordedGapMinutes: 0, notTradedMinutes: 2 } },
    );
    expect([...incompleteGroups]).toEqual(['candles1m:perp']);
    expect([...explainedGroups]).toEqual(['candles1m:spot']);
    // and the frame says which is which, rather than listing two identical-looking shortfalls
    expect(reasons.some((r) => r.includes('(absence evidenced)'))).toBe(true);
  });

  it('is empty when nothing is short', () => {
    const { incompleteGroups, explainedGroups, reasons } = assessWindows([]);
    expect(incompleteGroups.size).toBe(0);
    expect(explainedGroups.size).toBe(0);
    expect(reasons).toEqual([]);
  });
});

describe('the re-check window', () => {
  it('is derive\'s heal lookback, REFERENCED rather than copied', () => {
    // Two thresholds meaning the same thing drift. Shortening the heal pass must move the point
    // at which a frame is declared permanently refused, or frames get written off while
    // something is still trying to fix them.
    expect(HEAL_LOOKBACK_MS).toBe(DERIVE_LOOKBACK);
    expect(HEAL_LOOKBACK_MS).toBe(2 * 3_600_000);
  });
});
