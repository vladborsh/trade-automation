import { computeOpenInterest, nearestAt, pctChange, type OiPoint } from '../../src/features/calc/open-interest';

/**
 * IB-015 — the open-interest group (§8.2).
 *
 * The rule under test is that a delta needs a reading at BOTH ends. OI history starts at a
 * measured floor per symbol (2020-09 for BTC, 2021-12 otherwise), so "now with no reading 24 h
 * ago" is an ordinary situation, and `0 %` would read as "unchanged" when the truth is
 * "unknown".
 */

const CLOSE = Date.UTC(2026, 8, 28, 12, 0, 0);
const H = 3_600_000;
const FIVE_MIN = 300_000;

/** A reading every 5 minutes for `hours` back from the close. */
const series = (hours: number, value: (ts: number) => number): OiPoint[] => {
  const out: OiPoint[] = [];
  for (let ts = CLOSE - hours * H; ts <= CLOSE; ts += FIVE_MIN) out.push({ ts, value: value(ts) });
  return out;
};

describe('nearestAt', () => {
  const points: OiPoint[] = [
    { ts: CLOSE - 2 * FIVE_MIN, value: 1 },
    { ts: CLOSE, value: 3 },
  ];

  it('finds the closest reading', () => {
    expect(nearestAt(points, CLOSE)?.value).toBe(3);
    expect(nearestAt(points, CLOSE - 2 * FIVE_MIN)?.value).toBe(1);
  });

  it('accepts a reading inside the tolerance — slots do go missing', () => {
    expect(nearestAt(points, CLOSE - FIVE_MIN)?.value).toBeDefined();
  });

  it('REFUSES one outside it: a reading three hours away is not that comparison', () => {
    expect(nearestAt(points, CLOSE - 3 * H)).toBeNull();
  });

  it('is null on an empty series', () => {
    expect(nearestAt([], CLOSE)).toBeNull();
  });
});

describe('pctChange', () => {
  it('is a percentage, not a ratio', () => {
    expect(pctChange(110, 100)).toBeCloseTo(10, 10);
    expect(pctChange(90, 100)).toBeCloseTo(-10, 10);
  });

  it('is null when either end is missing — NOT zero', () => {
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
  });

  it('is null rather than Infinity when the base is zero', () => {
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe('computeOpenInterest', () => {
  it('computes both deltas on a full day of readings', () => {
    // linear from 1000 at −24 h to 1240 at the close: +10% over 24 h
    const points = series(24, (ts) => 1000 + ((ts - (CLOSE - 24 * H)) / (24 * H)) * 240);
    const out = computeOpenInterest({ points, closeTime: CLOSE });

    expect(out['oi.binance.now']).toBeCloseTo(1240, 6);
    expect(out['oi.d24h_pct']).toBeCloseTo(24, 6); // 1240 vs 1000
    expect(out['oi.d4h_pct']).toBeCloseTo(100 / 30, 6); // 1240 vs 1200 = 3.3333…%
  });

  it('a 24 h delta is NULL when history does not reach back that far', () => {
    const out = computeOpenInterest({ points: series(6, () => 1000), closeTime: CLOSE });
    expect(out['oi.binance.now']).toBe(1000);
    expect(out['oi.d4h_pct']).toBeCloseTo(0, 10); // 4 h of history: a real, flat comparison
    expect(out['oi.d24h_pct']).toBeNull(); // 24 h: unknown, not "unchanged"
  });

  it('at_7d_high is true when now is the highest reading in the window', () => {
    const points = series(48, (ts) => (ts === CLOSE ? 2000 : 1000));
    expect(computeOpenInterest({ points, closeTime: CLOSE })['oi.at_7d_high']).toBe(true);
  });

  it('at_7d_high is false when the week holds something higher', () => {
    const points = series(48, (ts) => (ts === CLOSE - 24 * H ? 5000 : 1000));
    expect(computeOpenInterest({ points, closeTime: CLOSE })['oi.at_7d_high']).toBe(false);
  });

  it('at_7d_high is NULL below a day of history — "at a 7-day high" would be trivially true', () => {
    const out = computeOpenInterest({ points: series(2, () => 1000), closeTime: CLOSE });
    expect(out['oi.at_7d_high']).toBeNull();
  });

  it('an empty series yields nulls throughout, never zeros', () => {
    const out = computeOpenInterest({ points: [], closeTime: CLOSE });
    expect(out['oi.binance.now']).toBeNull();
    expect(out['oi.d24h_pct']).toBeNull();
    expect(out['oi.at_7d_high']).toBeNull();
  });
});
