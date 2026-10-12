import { trueRange, wilderAtr, type AtrBar } from '../../src/features/math/wilder-atr';

/**
 * IB-015 §8.2 — Wilder ATR(14), with the arithmetic-mean ATR used as a foil rather than a source.
 */

const bar = (high: number, low: number, close: number): AtrBar => ({ high, low, close });

describe('trueRange', () => {
  it('is the bar range when there is no previous close', () => {
    // Not zero, and not a gap measured against itself: the first bar of a series has no gap.
    expect(trueRange(bar(110, 100, 105), null)).toBe(10);
  });

  it('counts a gap up from the previous close', () => {
    // prev close 90, bar 110..100 -> the real range travelled is 110 - 90 = 20, not 10
    expect(trueRange(bar(110, 100, 105), 90)).toBe(20);
  });

  it('counts a gap down from the previous close', () => {
    expect(trueRange(bar(110, 100, 105), 130)).toBe(30);
  });
});

describe('wilderAtr', () => {
  it('REFUSES rather than returning an ATR of a shorter period', () => {
    // 14 periods needs 15 bars: 14 true ranges each against a previous close. A number from
    // fewer would be an ATR(n) wearing ATR(14)'s name, and §8.2 fixes the window.
    const bars = Array.from({ length: 14 }, (_, i) => bar(110 + i, 100 + i, 105 + i));
    expect(wilderAtr(bars, 14)).toBeNull();
    expect(wilderAtr([...bars, bar(124, 114, 119)], 14)).not.toBeNull();
  });

  it('is the simple mean of the true ranges when there are exactly length + 1 bars', () => {
    // Seeding only, no recurrence yet: 4 bars give 3 true ranges and length is 3.
    // Each bar is (110+i, 100+i, 105+i), so for every i the previous close is 104+i and
    // TR = max(hl 10, |high - prevClose| 6, |low - prevClose| 4) = 10. The mean of three 10s.
    const bars = Array.from({ length: 4 }, (_, i) => bar(110 + i, 100 + i, 105 + i));
    expect(wilderAtr(bars, 3)).toBeCloseTo(10, 10);
  });

  it('smooths with Wilder\'s recurrence, worked by hand', () => {
    // length 2. Bars: A(10,0,5) B(12,2,7) C(30,0,20)
    // TR(B) = max(10, |12-5|, |2-5|) = 10
    // TR(C) = max(30, |30-7|, |0-7|) = 30
    // seed  = (10 + 30) / 2 = 20   -> only two TRs, so the seed IS the answer
    expect(wilderAtr([bar(10, 0, 5), bar(12, 2, 7), bar(30, 0, 20)], 2)).toBeCloseTo(20, 10);

    // add D(21,20,21): TR(D) = max(1, |21-20|, |20-20|) = 1
    // atr = (20 * (2 - 1) + 1) / 2 = 10.5
    const four = [bar(10, 0, 5), bar(12, 2, 7), bar(30, 0, 20), bar(21, 20, 21)];
    expect(wilderAtr(four, 2)).toBeCloseTo(10.5, 10);
  });

  it('IS NOT THE ARITHMETIC-MEAN ATR, and the gap is not a rounding difference', () => {
    // The trap this module exists for: `libs/indicators/computeAtr` is the mean of the last N
    // true ranges and would pass review as "the ATR we already have". Both numbers below are
    // worked by hand rather than taken from that function — insight-bot does not depend on
    // libs/indicators, and pinning against the thing you are trying not to become is circular.
    //
    // bars      A(10,0,5) B(12,2,7) C(100,0,50) D(52,48,50) E(51,49,50) F(50,49,50) G(51,50,50)
    // TR(B) = max(10, |12-5|,  |2-5|)  = 10
    // TR(C) = max(100,|100-7|, |0-7|)  = 100      <- one violent bar
    // TR(D) = max(4,  |52-50|, |48-50|)= 4
    // TR(E) = 2,  TR(F) = 1,  TR(G) = 1
    //
    // Wilder(3): seed = (10+100+4)/3 = 38
    //            -> (38*2 + 2)/3 = 26
    //            -> (26*2 + 1)/3 = 17.666…
    //            -> (17.666…*2 + 1)/3 = 12.111…      still carrying C
    // mean(3)  : last three TRs only = (2+1+1)/3 = 1.333…   C has fallen out entirely
    const bars: AtrBar[] = [
      bar(10, 0, 5), bar(12, 2, 7), bar(100, 0, 50),
      bar(52, 48, 50), bar(51, 49, 50), bar(50, 49, 50), bar(51, 50, 50),
    ];
    const WILDER = 109 / 9;        // 12.111…
    const ARITHMETIC_MEAN = 4 / 3; //  1.333…

    expect(wilderAtr(bars, 3)).toBeCloseTo(WILDER, 9);
    // nine times apart on the same bars: these are different statistics, not two roundings
    expect(WILDER / ARITHMETIC_MEAN).toBeGreaterThan(9);
  });

  it('carries a long-past shock with decaying weight rather than dropping it', () => {
    const calm = Array.from({ length: 30 }, () => bar(51, 50, 50));
    const withShock = [bar(10, 0, 5), bar(200, 0, 100), ...calm];
    const withoutShock = [bar(10, 0, 5), bar(51, 50, 50), ...calm];
    // the shock is 30 bars back and ATR(14) still remembers it
    expect(wilderAtr(withShock, 14) as number).toBeGreaterThan(wilderAtr(withoutShock, 14) as number);
  });

  it('rejects a nonsense length instead of quietly producing something', () => {
    expect(() => wilderAtr([bar(1, 0, 1), bar(1, 0, 1)], 0)).toThrow(/at least 1/);
  });
});
