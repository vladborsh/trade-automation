import { trueRange, trueRanges, wilderAtr } from '../../src/features/calc/atr';

/**
 * IB-015 — Wilder ATR(14), on worked numbers.
 *
 * ATR feeds P3's stop distance and the failed-high tolerance, so "close enough" moves a stop.
 * These tests pin Wilder's smoothing specifically, because a simple moving average of true
 * ranges differs from it for the whole life of the series and would pass a laxer test.
 */

const bar = (high: number, low: number, close: number) => ({ high, low, close });

describe('trueRange', () => {
  it('is the bar range when there is no previous close', () => {
    expect(trueRange(bar(110, 100, 105), null)).toBe(10);
  });

  it('takes the gap up from the previous close when that is larger', () => {
    // previous close 90, bar 110/100 → range 10, gap to high 20
    expect(trueRange(bar(110, 100, 105), 90)).toBe(20);
  });

  it('takes the gap down when the market gapped below', () => {
    expect(trueRange(bar(110, 100, 105), 130)).toBe(30);
  });

  it('the first true range in a series uses only high − low', () => {
    const tr = trueRanges([bar(110, 100, 105), bar(112, 104, 110)]);
    expect(tr[0]).toBe(10);
    expect(tr[1]).toBe(8); // 112−104=8 beats |112−105|=7 and |104−105|=1
  });
});

describe('wilderAtr', () => {
  /** 15 bars of constant range 10, no gaps: every true range is 10, so the ATR is 10. */
  const flat = Array.from({ length: 15 }, () => bar(110, 100, 105));

  it('a constant-range series has an ATR equal to that range', () => {
    expect(wilderAtr(flat)).toBeCloseTo(10, 10);
  });

  it('needs period + 1 bars, because the first contributes no gap', () => {
    // 14 bars would give a number, but a slightly different statistic wearing the same name
    expect(wilderAtr(flat.slice(0, 14))).toBeNull();
    expect(wilderAtr(flat.slice(0, 15))).not.toBeNull();
  });

  it('smooths WILDER, not as a simple mean — worked by hand', () => {
    // 15 bars of range 10 seed ATR = 10; a 16th bar with true range 24 gives
    // (10 × 13 + 24) / 14 = 11.0, where a simple 14-mean would give exactly 11.0 too —
    // so use a second step, which separates them: (11 × 13 + 24) / 14 = 11.928571…
    const bars = [...flat, bar(124, 100, 110), bar(124, 100, 110)];
    const atr = wilderAtr(bars) as number;
    expect(atr).toBeCloseTo(11.9285714, 6);

    const simpleMeanOfLast14 =
      // a simple mean over the last 14 true ranges would be (12×10 + 24 + 24)/14 = 12.0
      (12 * 10 + 24 + 24) / 14;
    expect(atr).not.toBeCloseTo(simpleMeanOfLast14, 3);
  });

  it('widens with a gap even when the bar itself is narrow', () => {
    const quiet = Array.from({ length: 15 }, () => bar(101, 100, 100.5));
    const withGap = [...quiet, bar(121, 120, 120.5)]; // 1-wide bar, 20 above the last close
    expect(wilderAtr(withGap) as number).toBeGreaterThan(wilderAtr(quiet) as number);
  });

  it('an empty or short series is null, never 0', () => {
    expect(wilderAtr([])).toBeNull();
    expect(wilderAtr([bar(1, 0, 0.5)])).toBeNull();
  });

  it('honours a non-default period', () => {
    expect(wilderAtr(flat.slice(0, 4), 3)).toBeCloseTo(10, 10);
    expect(wilderAtr(flat.slice(0, 3), 3)).toBeNull();
  });
});
