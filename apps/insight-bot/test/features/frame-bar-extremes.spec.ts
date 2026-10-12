import { frameBarExtremes } from '../../src/features/gather';

/**
 * IB-018 — the frame bar's high and low, reduced over the 15m bars that compose it.
 *
 * This is the function the registry's `def` is about. `px.close` is one bar's value on either
 * timeframe because a 4h close IS its final 15m close; a 4h high is the maximum across sixteen
 * bars. The specs below are mostly about that difference, because the plausible wrong
 * implementation — take the last bar — is right for the close and wrong here, and wrong in a
 * direction that moves P3's stop.
 */
const M15 = 15 * 60_000;
const CLOSE = Date.UTC(2026, 9, 12, 16, 0, 0); // a 4h boundary

/** Sixteen 15m bars filling [CLOSE-4h, CLOSE), with the extreme placed where asked. */
const bars = (extremeAt: number, high: number, low: number) =>
  Array.from({ length: 16 }, (_, i) => ({
    openTimeSec: (CLOSE - 16 * M15 + i * M15) / 1000,
    high: i === extremeAt ? high : 100,
    low: i === extremeAt ? low : 99,
  }));

describe('frameBarExtremes on a 4h frame', () => {
  it('takes the MAX and MIN across all sixteen bars', () => {
    expect(frameBarExtremes(bars(0, 150, 50), '4h', CLOSE)).toEqual({ barHigh: 150, barLow: 50 });
  });

  it('finds an extreme in the FIRST bar, which "take the last bar" misses', () => {
    // The whole point of the def's wording. A cascade's low is usually not in the final bar.
    const out = frameBarExtremes(bars(0, 150, 50), '4h', CLOSE);
    expect(out.barLow).toBe(50);
    expect(out.barLow).not.toBe(99); // what the last bar would have given
  });

  it('finds an extreme in the MIDDLE bar too', () => {
    expect(frameBarExtremes(bars(7, 150, 50), '4h', CLOSE).barHigh).toBe(150);
  });

  it('excludes bars outside the 4h window', () => {
    // A bar opening exactly at the close belongs to the NEXT frame; including it would let a
    // later bar set this frame's extreme, which is lookahead at the bar level.
    const withNext = [
      ...bars(0, 150, 50),
      { openTimeSec: CLOSE / 1000, high: 999, low: 1 },
    ];
    expect(frameBarExtremes(withNext, '4h', CLOSE)).toEqual({ barHigh: 150, barLow: 50 });
  });

  it('excludes bars before the window opens', () => {
    const withPrev = [
      { openTimeSec: (CLOSE - 17 * M15) / 1000, high: 999, low: 1 },
      ...bars(0, 150, 50),
    ];
    expect(frameBarExtremes(withPrev, '4h', CLOSE)).toEqual({ barHigh: 150, barLow: 50 });
  });

  it('reduces over whatever bars ARE present, rather than refusing a short window', () => {
    // Completeness is the frame's job, not this function's: the group's shortfall already makes
    // every agg:15m key refuse. Duplicating that check here would refuse twice for one reason.
    expect(frameBarExtremes(bars(0, 150, 50).slice(0, 3), '4h', CLOSE))
      .toEqual({ barHigh: 150, barLow: 50 });
  });
});

describe('frameBarExtremes on a 15m frame', () => {
  it('uses only the single bar closing at the frame close', () => {
    const out = frameBarExtremes(bars(0, 150, 50), '15m', CLOSE);
    expect(out).toEqual({ barHigh: 100, barLow: 99 }); // the last bar, not the window's extreme
  });

  it('agrees with the 4h reduction when the window holds one bar', () => {
    const one = [{ openTimeSec: (CLOSE - M15) / 1000, high: 120, low: 80 }];
    expect(frameBarExtremes(one, '15m', CLOSE)).toEqual({ barHigh: 120, barLow: 80 });
  });
});

describe('frameBarExtremes with nothing stored', () => {
  it('returns nulls rather than reaching for a neighbouring bar', () => {
    // An extreme taken from an arbitrary nearby bar is a stop in the wrong place, which is
    // worse than no stop at all.
    expect(frameBarExtremes([], '4h', CLOSE)).toEqual({ barHigh: null, barLow: null });
    expect(frameBarExtremes(bars(0, 150, 50), '15m', CLOSE + 10 * M15))
      .toEqual({ barHigh: null, barLow: null });
  });
});
