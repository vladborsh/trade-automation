import { expectedFrames } from '../../src/features/frame-coverage';

/**
 * IB-015 — the denominator, computed from the window and never from the rows.
 *
 * A count derived from stored frames cannot notice that frames are not stored, which is
 * IB-BUG-010 one layer up: "the pass was not running" and "nothing was wrong" must not produce
 * the same number.
 */
const H = 3_600_000;
const at = (h: number, m = 0) => Date.UTC(2026, 9, 12, h, m);

describe('expectedFrames', () => {
  it('counts the 15m closes in a day', () => {
    expect(expectedFrames('15m', at(0), at(24))).toBe(96);
  });

  it('counts the 4h closes in a day', () => {
    expect(expectedFrames('4h', at(0), at(24))).toBe(6);
  });

  it('counts closes, not spans — a window starting mid-bar gets the closes inside it', () => {
    // 12:07 to 13:00 contains the 12:15, 12:30 and 12:45 closes. Not 13:00: `to` is exclusive.
    expect(expectedFrames('15m', at(12, 7), at(13))).toBe(3);
  });

  it('includes a close exactly on `from` and excludes one exactly on `to`', () => {
    // Half-open, matching every other window in the app. Getting this wrong by one makes every
    // audit report one missing frame for ever, which is how a real one stops being noticed.
    expect(expectedFrames('15m', at(12), at(12, 15))).toBe(1);
    expect(expectedFrames('15m', at(12), at(12))).toBe(0);
  });

  it('is zero for an inverted or empty window rather than negative', () => {
    expect(expectedFrames('15m', at(13), at(12))).toBe(0);
  });

  it('is zero when the window falls entirely between two closes', () => {
    expect(expectedFrames('4h', at(12, 1), at(12, 2))).toBe(0);
  });

  it('is epoch-anchored, so the same span anywhere gives the same count', () => {
    expect(expectedFrames('15m', at(3), at(3) + 6 * H)).toBe(expectedFrames('15m', at(9), at(9) + 6 * H));
  });
});
