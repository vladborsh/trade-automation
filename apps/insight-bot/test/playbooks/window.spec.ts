import { expectedCloses, isWindowContiguous, missingCloses } from '../../src/playbooks/window';

/**
 * IB-017 — the armed window's contiguity.
 *
 * An ARMED setup claims the trigger did not fire in each close since it armed. These assertions
 * are about never making that claim on closes we did not evaluate.
 */
const M15 = 15 * 60_000;
const at = (h: number, m = 0) => Date.UTC(2026, 9, 12, h, m);

describe('expectedCloses', () => {
  it('lists the closes strictly after arming, up to and including now', () => {
    // Strictly after: the close we armed ON is not a close we then waited through.
    expect(expectedCloses(at(12, 0), at(12, 45), M15)).toEqual([at(12, 15), at(12, 30), at(12, 45)]);
  });

  it('is empty when no close has passed yet', () => {
    expect(expectedCloses(at(12, 0), at(12, 0), M15)).toEqual([]);
    expect(expectedCloses(at(12, 0), at(12, 14), M15)).toEqual([]);
  });

  it('is epoch-anchored, so an arm mid-bar does not shift every later boundary', () => {
    // Armed at 12:07 — the next close is still 12:15, not 12:22.
    expect(expectedCloses(at(12, 7), at(12, 30), M15)).toEqual([at(12, 15), at(12, 30)]);
  });

  it('crosses an hour and a day without special-casing either', () => {
    expect(expectedCloses(Date.UTC(2026, 9, 12, 23, 45), Date.UTC(2026, 9, 13, 0, 15), M15))
      .toEqual([Date.UTC(2026, 9, 13, 0, 0), Date.UTC(2026, 9, 13, 0, 15)]);
  });

  it('is empty rather than infinite for a nonsense timeframe', () => {
    expect(expectedCloses(at(12), at(13), 0)).toEqual([]);
  });
});

describe('isWindowContiguous', () => {
  const expected = [at(12, 15), at(12, 30), at(12, 45)];

  it('is true when every expected close was evaluated', () => {
    expect(isWindowContiguous(expected, new Set(expected))).toBe(true);
  });

  it('is FALSE when one close in the middle was never evaluated', () => {
    expect(isWindowContiguous(expected, new Set([at(12, 15), at(12, 45)]))).toBe(false);
  });

  it('checks membership, NOT counts — the failure a count comparison hides', () => {
    // One expected close missing and one unexpected close present gives matching totals. That
    // is exactly the shape a clock or boundary bug produces, and it must not pass.
    const seen = new Set([at(12, 15), at(12, 30), at(12, 52)]);
    expect(seen.size).toBe(expected.length);
    expect(isWindowContiguous(expected, seen)).toBe(false);
  });

  it('is true for an empty window — nothing has been claimed yet', () => {
    expect(isWindowContiguous([], new Set())).toBe(true);
  });

  it('tolerates extra evaluations beyond the window', () => {
    expect(isWindowContiguous(expected, new Set([...expected, at(13, 0)]))).toBe(true);
  });
});

describe('missingCloses', () => {
  it('names the closes, so the audit row says which rather than how many', () => {
    expect(missingCloses([at(12, 15), at(12, 30)], new Set([at(12, 15)]))).toEqual([at(12, 30)]);
  });
});
