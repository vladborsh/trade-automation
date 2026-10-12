import { median, normBasis, normPeriodStart, sideStats, unavailableReason } from '../../src/web/liquidations/norm';

/**
 * IB-038 §12.2 — «× от нормы».
 *
 * The specs that matter here are the refusals. A ratio is easy to compute and easy to compute
 * wrongly, and every wrong version still renders as a confident number on a card.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 7, 18, 0, 0);

describe('median', () => {
  it('is the middle of an odd sample and the mean of the middle two of an even one', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is null for an empty sample, not 0', () => {
    // 0 is a measurement — "the usual window holds nothing". Absent is not the same claim.
    expect(median([])).toBeNull();
  });

  it('counts the quiet windows', () => {
    // The median of [0,0,0,0,100] is 0, and that is correct: four windows in five hold nothing,
    // so a 100 is not "1× normal". Dropping the zeros would make it exactly that.
    expect(median([0, 0, 0, 0, 100])).toBe(0);
  });
});

describe('normPeriodStart (§12.4: a venue joining later must not fake a spike)', () => {
  it('starts when the LAST venue of the set started, not 30 days ago', () => {
    const bybit = T0 - 25 * DAY;
    const okx = T0 - 3 * DAY;
    expect(normPeriodStart([bybit, okx], T0)).toBe(okx);
  });

  it('never reaches back further than the 30-day cap', () => {
    const ancient = T0 - 400 * DAY;
    expect(normPeriodStart([ancient], T0)).toBe(T0 - 30 * DAY);
  });

  it('gives an EMPTY period when nothing has ever been seen, not a 30-day one', () => {
    // Falling back to the cap would claim thirty days of observation from zero rows, and the
    // window would then report «нет нормы» (a measurement) instead of «нет данных» (an absence).
    expect(normPeriodStart([], T0)).toBe(T0);
  });
});

describe('sideStats', () => {
  it('divides the trailing window by the median when there is a norm', () => {
    const stats = sideStats({ trailing: 300, alignedSums: [100, 100, 100, 200, 50], periodDays: 30 });
    expect(stats.median).toBe(100);
    expect(stats.ratio).toBe(3);
    expect(stats.usd).toBe(300);
  });

  it('REFUSES a ratio under 7 days of history, and does not compute a median either', () => {
    const stats = sideStats({ trailing: 1_000_000, alignedSums: [1, 2, 3], periodDays: 6.9 });
    expect(stats.ratio).toBeNull();
    expect(stats.median).toBeNull();
    // the amount is still reported: what happened is known, only "how unusual" is not
    expect(stats.usd).toBe(1_000_000);
  });

  it('REFUSES a ratio when the median is 0, rather than reporting Infinity or 0', () => {
    // The common case on the real tape: 9 of 226 hourly windows hold anything at all.
    const stats = sideStats({ trailing: 50_000, alignedSums: [0, 0, 0, 0, 0, 0, 0], periodDays: 30 });
    expect(stats.ratio).toBeNull();
    expect(stats.median).toBe(0);
    expect(Number.isFinite(stats.usd)).toBe(true);
  });

  it('a quiet trailing window against a real norm is 0, which IS a measurement', () => {
    const stats = sideStats({ trailing: 0, alignedSums: [100, 100, 100], periodDays: 30 });
    expect(stats.ratio).toBe(0);
    expect(stats.median).toBe(100);
  });
});

describe('unavailableReason', () => {
  const withRatio = { usd: 1, median: 1, ratio: 1 };
  const without = { usd: 1, median: 0, ratio: null };

  it('names short history ahead of a missing norm', () => {
    expect(unavailableReason(3, [without, without, without])).toBe('insufficient_history');
  });

  it('is no_norm only when NO side could be measured', () => {
    expect(unavailableReason(30, [without, without, without])).toBe('no_norm');
  });

  it('is null when any side has a norm — one quiet side is an ordinary market', () => {
    expect(unavailableReason(30, [withRatio, without, withRatio])).toBeNull();
  });
});

describe('normBasis (what the figure is measured against)', () => {
  it('reports observed windows, not elapsed time', () => {
    // The Tech Lead's ruling of 2026-10-07: the collectors write no uptime rows (IB-BUG-010), so
    // elapsed days claim observation we cannot prove. 226 hours elapsed, 9 of them hold data.
    const alignedSums = [...Array(217).fill(0), ...Array(9).fill(1000)];
    const basis = normBasis({
      periodDays: 9.4, alignedSums, venues: ['okx', 'bybit'], sides: [{ usd: 1, median: 0, ratio: null }],
    });
    expect(basis.windowsInPeriod).toBe(226);
    expect(basis.windowsObserved).toBe(9);
    expect(basis.periodDays).toBe(9.4);
  });

  it('names the venue set the numerator and the median share, sorted so it is stable', () => {
    const basis = normBasis({ periodDays: 30, alignedSums: [1], venues: ['okx', 'bybit'], sides: [{ usd: 1, median: 1, ratio: 1 }] });
    expect(basis.venues).toEqual(['bybit', 'okx']);
  });

  it('carries the reason when there is no ratio to show', () => {
    const basis = normBasis({ periodDays: 2, alignedSums: [], venues: [], sides: [{ usd: 0, median: null, ratio: null }] });
    expect(basis.unavailable).toBe('insufficient_history');
    expect(basis.windowsInPeriod).toBe(0);
  });
});
