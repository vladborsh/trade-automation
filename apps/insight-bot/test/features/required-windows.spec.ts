import { WEB_FEATURE_KEYS, WEB_FEATURE_SPEC } from '@trade-automation/contracts';
import {
  GROUP_LOOKBACK_MS, declaredLookbackMs, groupsFor, lookbackMs,
} from '../../src/features/required-windows';

/**
 * IB-015 — the gather windows, held to the registry.
 *
 * The failure this guards against is silent: a window one bar short does not crash, it hands a
 * calculator fewer bars than the key's definition claims and publishes the result as though the
 * period were right.
 */
describe('required windows', () => {
  it('declares a lookback for every group any key reads', () => {
    for (const group of groupsFor()) {
      expect(() => lookbackMs(group)).not.toThrow();
    }
  });

  it('has no lookback for a group no key reads — an unused window is a stale one', () => {
    expect(Object.keys(GROUP_LOOKBACK_MS).sort()).toEqual(groupsFor());
  });

  /**
   * The real assertion: every key's own parameters must fit inside the window its group is read
   * over. Widen `oi.at_7d_high` to 14 days without touching the table and this fails, naming the
   * key — rather than the page quietly showing a 7-day high computed over 7 days of a 14-day
   * question.
   */
  it('reads at least as far back as every key reading that group asks for', () => {
    const tooShort: string[] = [];
    for (const key of WEB_FEATURE_KEYS) {
      const declared = declaredLookbackMs(key);
      if (declared === null) continue;
      for (const group of WEB_FEATURE_SPEC[key].inputs) {
        if (lookbackMs(group) < declared) {
          tooShort.push(`${key} needs ${declared} ms of ${group}, table reads ${lookbackMs(group)} ms`);
        }
      }
    }
    expect(tooShort).toEqual([]);
  });

  it('gives the ATR groups period + 1 bars, because Wilder seeds from a previous close', () => {
    // atr.4h.14 over exactly 14 bars returns null: a window one bar short turns a working key
    // into a permanent refusal, which looks like missing data rather than a short read.
    expect(declaredLookbackMs('atr.4h.14')).toBe(15 * 4 * 3_600_000);
    expect(lookbackMs('agg:4h')).toBeGreaterThanOrEqual(declaredLookbackMs('atr.4h.14') as number);
  });

  it('counts the slope key’s previous window as well as its current one', () => {
    // cvd.perp.slope_4h compares 4 h against the PREVIOUS 4 h: reading only 4 h would make the
    // comparison a comparison with nothing.
    expect(declaredLookbackMs('cvd.perp.slope_4h')).toBe(8 * 3_600_000);
  });

  it('returns null for a key whose window is not a span', () => {
    expect(declaredLookbackMs('funding.binance.rate')).toBeNull();
    expect(declaredLookbackMs('ls.top_position')).toBeNull();
    expect(declaredLookbackMs('label.p4')).toBeNull();
  });
});
