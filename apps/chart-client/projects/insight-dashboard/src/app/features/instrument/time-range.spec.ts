import { WEB_MAX_1M_RANGE_DAYS } from '@trade-automation/contracts';
import {
  allowedTimeframes, bucketFor, effectiveTimeframe, findPreset, isRefused, RANGE_PRESETS, rangeOf,
} from './time-range';
import { I18nService } from '../../i18n/i18n.service';

/**
 * IB-031 — the page must never offer a range/timeframe pair the server refuses.
 */

const preset = (key: string) => findPreset(key)!;
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

describe('rangeOf', () => {
  it('ends now and starts the preset\'s span earlier', () => {
    expect(rangeOf(preset('1d'), NOW)).toEqual({ fromMs: NOW - 86_400_000, toMs: NOW });
    expect(rangeOf(preset('1y'), NOW).fromMs).toBe(NOW - 365 * 86_400_000);
  });
});

describe('the page never offers what the server will refuse', () => {
  it('knows which pairs are refused', () => {
    expect(isRefused(preset('3m'), '1m')).toBe(false); // exactly 90 days is allowed
    expect(isRefused(preset('1y'), '1m')).toBe(true);
    expect(isRefused(preset('1y'), '1h')).toBe(false);
    expect(WEB_MAX_1M_RANGE_DAYS).toBe(90);
  });

  it('the switch hides 1m only for ranges that cannot have it', () => {
    expect(allowedTimeframes(preset('1w'))).toContain('1m');
    expect(allowedTimeframes(preset('1y'))).not.toContain('1m');
    // and never removes anything else
    expect(allowedTimeframes(preset('1y'))).toEqual(['15m', '1h', '4h', '1d']);
  });

  it('coarsens rather than sending a request that returns RANGE_TOO_WIDE', () => {
    // showing an error for a combination we offered is worse than quietly coarsening — as long
    // as the page says so, which the component does next to the switch
    expect(effectiveTimeframe(preset('1y'), '1m')).toBe('15m');
    expect(effectiveTimeframe(preset('1w'), '1m')).toBe('1m');
    expect(effectiveTimeframe(preset('1y'), '4h')).toBe('4h');
  });

  it('every preset has at least one usable timeframe', () => {
    for (const p of RANGE_PRESETS) expect(allowedTimeframes(p).length).toBeGreaterThan(0);
  });
});

describe('bucketFor', () => {
  it('is fine enough to see a cascade on a short range', () => {
    expect(bucketFor(preset('1d'))).toBe('1m');
    expect(bucketFor(preset('3d'))).toBe('1m');
  });

  it('coarsens with the range so a quarter is not 129,600 bars', () => {
    expect(bucketFor(preset('1w'))).toBe('15m');
    expect(bucketFor(preset('1m'))).toBe('15m');
    expect(bucketFor(preset('3m'))).toBe('1h');
    expect(bucketFor(preset('1y'))).toBe('1h');
  });

  it('is independent of the candle timeframe — a cascade is worth seeing at 1m even at 1h price', () => {
    // bucketFor takes no timeframe argument at all; this test documents that on purpose
    expect(bucketFor.length).toBe(1);
  });
});

describe('the presets carry keys, not text (§11)', () => {
  it('every preset resolves in BOTH tables — a missing one would render as a raw key', () => {
    const en = new I18nService();
    en.setLang('en');
    const ru = new I18nService();
    ru.setLang('ru');
    for (const p of RANGE_PRESETS) {
      expect(en.t(p.labelKey)).not.toBe(p.labelKey);
      expect(ru.t(p.labelKey)).not.toBe(p.labelKey);
      expect(ru.t(p.labelKey)).not.toBe(en.t(p.labelKey)); // actually translated, not copied
    }
  });
});

describe('findPreset', () => {
  it('returns null for an unknown key rather than a default, so a bad URL is visible', () => {
    expect(findPreset('nonsense')).toBeNull();
    expect(findPreset('1w')?.days).toBe(7);
  });
});
