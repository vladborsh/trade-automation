import { barOpenOf, oiPerBar } from '../../../src/insights/divergence/oi-per-bar';
import { pivots } from '../../../src/insights/divergence/pivots';

/**
 * IB-109 (V4) — which bar owns a 5 m OI reading, and the per-bar min / max. The venue labels a reading
 * with its MOMENT (the fixture spec below pins it): a bar [open, open + tf) owns `open < t ≤ open + tf`.
 */
const TF = 900;
const OPEN = 1_793_000_700 - (1_793_000_700 % TF);

describe('barOpenOf — a reading belongs to the bar it closes or falls inside', () => {
  it('the reading at a bar’s CLOSE is that bar’s; the one at its OPEN is the previous bar’s', () => {
    expect(barOpenOf(OPEN + TF, TF)).toBe(OPEN); // 17:15 reading → the 17:00 bar (its close)
    expect(barOpenOf(OPEN + 300, TF)).toBe(OPEN);
    expect(barOpenOf(OPEN + 600, TF)).toBe(OPEN);
    expect(barOpenOf(OPEN, TF)).toBe(OPEN - TF); // 17:00 reading → the 16:45 bar
    // 1h and 4h bars: the same rule
    const open4h = OPEN - (OPEN % 14_400); // a 4h boundary is also a 1h one
    expect([barOpenOf(open4h + 3_600, 3_600), barOpenOf(open4h + 14_400, 14_400), barOpenOf(open4h, 3_600)]).toEqual([open4h, open4h, open4h - 3_600]);
  });
});

describe('oiPerBar', () => {
  it('per bar: the min and the max of the readings it owns, with their own times; a bar with none is null', () => {
    const r = oiPerBar([OPEN, OPEN + TF, OPEN + 2 * TF], [
      { time: OPEN + 300, oi: 1000 }, { time: OPEN + 600, oi: 960 }, { time: OPEN + 900, oi: 1010 }, // bar 0: 960 … 1010
      { time: OPEN + 1200, oi: 1005 }, // bar 1
      // bar 2: nothing
    ], TF);
    expect(r.min).toEqual([960, 1005, null]);
    expect(r.max).toEqual([1010, 1005, null]);
    expect(r.minTime).toEqual([OPEN + 600, OPEN + 1200, null]);
    expect(r.maxTime).toEqual([OPEN + 900, OPEN + 1200, null]);
  });

  it('equal readings: the earlier one names the time; readings outside every bar are ignored; order does not matter', () => {
    const r = oiPerBar([OPEN], [{ time: OPEN + 900, oi: 900 }, { time: OPEN + 300, oi: 900 }, { time: OPEN + 5 * TF, oi: 1 }], TF);
    expect([r.min[0], r.minTime[0], r.maxTime[0]]).toEqual([900, OPEN + 300, OPEN + 300]);
  });

  it('a bar-open reading assigned to the wrong bar would move a pivot: the ownership is load-bearing', () => {
    // three bars; the only low reading is labelled exactly at bar 2's open — it is bar 1's close
    const opens = [OPEN, OPEN + TF, OPEN + 2 * TF, OPEN + 3 * TF, OPEN + 4 * TF];
    const readings = opens.flatMap((o) => [300, 600, 900].map((d) => ({ time: o + d, oi: 1000 })));
    readings.push({ time: OPEN + 2 * TF, oi: 900 }); // replaces nothing: an extra, lower reading at 2's open
    const min = oiPerBar(opens, readings, TF).min;
    expect(min).toEqual([1000, 900, 1000, 1000, 1000]);
    expect(pivots(min, 1, 'low')).toEqual([1]); // bar 1, not bar 2
  });
});

/**
 * The venue convention `oiPerBar` rests on, pinned by a committed probe: 90 reads (5 coins × 6 boundaries
 * × 15/35/60 s after each). If Binance ever labelled a row with the START of the 5 minutes it describes,
 * a row labelled at a boundary could not exist seconds after that boundary — this fails, and the
 * ownership rule (`open < t ≤ close`) must be revisited.
 */
describe('openInterestHist labels are the moment of the reading (fixture)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const f = require('../../fixtures/binance/open-interest-hist-labels.json') as { reads: Array<{ symbol: string; requestedAt: string; labels: string[] }> };

  it('the probe is what it says: 90 reads over six boundaries, five coins', () => {
    expect(f.reads).toHaveLength(90);
    expect(new Set(f.reads.map((r) => r.symbol)).size).toBe(5);
    expect(new Set(f.reads.map((r) => Math.floor(Date.parse(r.requestedAt) / 300_000))).size).toBe(6);
  });

  it('no label is ever later than the request that returned it', () => {
    const future = f.reads.flatMap((r) => r.labels.filter((l) => Date.parse(l) > Date.parse(r.requestedAt)));
    expect(future).toEqual([]);
  });

  it('on EVERY boundary some coin already serves the row labelled with it, under a minute after it', () => {
    const byBoundary = new Map<number, number>();
    for (const r of f.reads) {
      const boundary = Math.floor(Date.parse(r.requestedAt) / 300_000) * 300_000;
      if (r.labels.some((l) => Date.parse(l) === boundary)) {
        const age = Date.parse(r.requestedAt) - boundary;
        byBoundary.set(boundary, Math.min(byBoundary.get(boundary) ?? Infinity, age));
      }
    }
    expect(byBoundary.size).toBe(6);
    expect(Math.max(...byBoundary.values())).toBeLessThan(60_000);
  });
});
