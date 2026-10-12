import { assertComparableContexts, regimeContext, type RegimeContextInput } from '../../src/regime/context';
import type { PercentileRank } from '../../src/regime/axes';
import type { WebFeatureValue } from '@trade-automation/contracts';
import { REGIME_VERSION, regimeSpecFingerprint } from '../../src/regime/regime-spec';

const percentileRank: PercentileRank = (sample, value, minPeriods) => {
  if (sample.length < minPeriods) return null;
  let atOrBelow = 0;
  for (const x of sample) if (x <= value) atOrBelow += 1;
  return atOrBelow / sample.length;
};

const value = (n: number): WebFeatureValue => ({ ok: true, value: n });
const ramp = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

function input(overrides: Partial<RegimeContextInput> = {}): RegimeContextInput {
  return {
    symbol: 'BTCUSDT',
    closeTime: Date.UTC(2026, 9, 12, 12, 0) / 1000,
    tf: '4h',
    frameVersion: 1,
    frameRevision: 1,
    computedMode: 'live',
    emaFastNow: value(106),
    emaFastThen: value(100),
    emaSlow: value(90),
    price: value(100),
    atr: value(85),
    atrHistory: ramp(100),
    oi: value(85),
    oiHistory: ramp(100),
    fundingRates: [0.0001, 0.0002, 0.0003],
    events: [],
    calendarLoaded: true,
    ...overrides,
  };
}

describe('regimeContext', () => {
  it('assembles the five axes from one frame', () => {
    const row = regimeContext(input(), percentileRank);
    expect(row.trend).toEqual({ ok: true, value: 'UP' });
    expect(row.vol).toEqual({ ok: true, value: 'HIGH' });
    expect(row.leverage).toEqual({ ok: true, value: 'LEVERED' });
    expect(row.crowdedSide).toEqual({ ok: true, value: 'LONGS' });
    expect(row.eventWindow).toEqual({ ok: true, value: 'CLEAR' });
  });

  it('records what produced it: the frame’s version, revision and MODE, and its own', () => {
    const row = regimeContext(input({ frameVersion: 1, frameRevision: 3 }), percentileRank);
    expect(row).toMatchObject({
      frameVersion: 1,
      frameRevision: 3,
      computedMode: 'live',
      regimeVersion: REGIME_VERSION,
      specFingerprint: regimeSpecFingerprint(),
    });
    expect(regimeContext(input({ computedMode: 'backfill' }), percentileRank).computedMode).toBe('backfill');
  });

  it('is stamped by the bar, never by wall clock', () => {
    const closeTime = Date.UTC(2026, 9, 11, 8, 0) / 1000;
    expect(regimeContext(input({ closeTime }), percentileRank).closeTime).toBe(closeTime);
  });

  it('lets one axis refuse without taking the others down with it', () => {
    // the whole argument for per-axis refusals over one `complete` flag: a missing 200-day EMA
    // must not cost the frame its volatility reading
    const row = regimeContext(
      input({ emaSlow: { ok: false, why: 'insufficient_history' }, calendarLoaded: false }),
      percentileRank,
    );
    expect(row.trend).toEqual({ ok: false, why: 'insufficient_history' });
    expect(row.eventWindow).toEqual({ ok: false, why: 'no_data' });
    expect(row.vol).toEqual({ ok: true, value: 'HIGH' });
    expect(row.leverage).toEqual({ ok: true, value: 'LEVERED' });
  });

  it('has no overall “regime known” flag to forget to read', () => {
    const row = regimeContext(input(), percentileRank) as unknown as Record<string, unknown>;
    expect(row.complete).toBeUndefined();
    expect(row.ok).toBeUndefined();
  });
});

describe('assertComparableContexts', () => {
  const base = regimeContext(input(), percentileRank);

  it('accepts rows from the same definitions, and an empty list', () => {
    expect(() => assertComparableContexts([base, regimeContext(input({ frameRevision: 2 }), percentileRank)])).not.toThrow();
    expect(() => assertComparableContexts([])).not.toThrow();
  });

  it('throws on a set that mixes live and backfilled frames — that is lookahead', () => {
    // derive heals buckets after the fact, so a backfilled frame is systematically better
    // informed than the live frame for the same close: an axis can read HIGH where the live frame
    // could only have refused. Learning across the two is learning from what was not knowable.
    const backfilled = regimeContext(input({ computedMode: 'backfill' }), percentileRank);
    expect(() => assertComparableContexts([base, backfilled])).toThrow(/live and backfilled/);
  });

  it('throws when the frame version differs — two meanings, one comparison', () => {
    const other = { ...base, frameVersion: 2 };
    expect(() => assertComparableContexts([base, other])).toThrow(/different definitions/);
  });

  it('throws when the axes’ own constants differ, which a version number alone would miss', () => {
    // someone edits a band and forgets to bump REGIME_VERSION: the fingerprint still catches it
    const other = { ...base, specFingerprint: 'deadbeef' };
    expect(() => assertComparableContexts([base, other])).toThrow(/different definitions/);
  });
});
