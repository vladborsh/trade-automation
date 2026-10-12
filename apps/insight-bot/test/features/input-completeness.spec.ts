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
  group: 'candles1m:perp', keys: ['cvd.perp.24h'], expected: 240, present: 238,
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
    const { incompleteKeys, explainedKeys, reasons } = assessWindows(
      [short({ group: 'candles1m:perp', keys: ['cvd.perp.24h'] }),
        short({ group: 'candles1m:spot', keys: ['cvd.spot.24h'], detail: 'candles_1m spot halted' })],
      { 'candles1m:spot': { recordedGapMinutes: 0, notTradedMinutes: 2 } },
    );
    expect([...incompleteKeys]).toEqual(['cvd.perp.24h']);
    expect([...explainedKeys]).toEqual(['cvd.spot.24h']);
    // and the frame says which is which, rather than listing two identical-looking shortfalls
    expect(reasons.some((r) => r.includes('(absence evidenced)'))).toBe(true);
  });

  it('is empty when nothing is short', () => {
    const { incompleteKeys, explainedKeys, reasons } = assessWindows([]);
    expect(incompleteKeys.size).toBe(0);
    expect(explainedKeys.size).toBe(0);
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

/**
 * IB-047 — a shortfall carries the KEYS it affects, not just its group.
 */
describe('a shortfall is scoped to the keys that read its window', () => {
  it('marks only the keys named, leaving siblings in the same group alone', () => {
    const { incompleteKeys } = assessWindows([{
      group: 'agg:15m',
      keys: ['px.ret_24h', 'px.drawdown_from_24h_high'],
      expected: 96, present: 86,
      detail: 'candles_agg 15m 24h window, 86 of 96',
    }]);
    expect([...incompleteKeys].sort()).toEqual(['px.drawdown_from_24h_high', 'px.ret_24h']);
    expect(incompleteKeys.has('px.close')).toBe(false);
  });

  it('routes an evidenced shortfall to the explained set, per key', () => {
    const { incompleteKeys, explainedKeys } = assessWindows(
      [{ group: 'agg:15m', keys: ['px.ret_24h'], expected: 96, present: 86, detail: 'd' }],
      { 'agg:15m': { recordedGapMinutes: 0, notTradedMinutes: 1000 } },
    );
    expect([...explainedKeys]).toEqual(['px.ret_24h']);
    expect(incompleteKeys.size).toBe(0);
  });

  it('accumulates across two windows of one group without merging them', () => {
    // The two shortfalls are different facts about different windows; a group-level union would
    // lose which keys each one actually concerns.
    const { incompleteKeys } = assessWindows([
      { group: 'agg:15m', keys: ['px.ret_24h'], expected: 96, present: 86, detail: 'a' },
      { group: 'agg:15m', keys: ['px.close'], expected: 1, present: 0, detail: 'b' },
    ]);
    expect([...incompleteKeys].sort()).toEqual(['px.close', 'px.ret_24h']);
  });
});
