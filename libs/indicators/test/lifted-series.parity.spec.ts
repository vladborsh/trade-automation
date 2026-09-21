import { Candle } from '@trade-automation/contracts';
import { computeAtr, computeFvg, computePreviousHourLH, computeRange, computeVwapBand } from '../src';
import { atrSeries, ifvgSeries, previousHourSeries, rangeSeries, vwapBandSeries } from '../src';
import type { IndicatorValue } from '../src';
import real from './fixtures/btcusdt-1m-2days.json';
import { bar } from './test-helpers';

/**
 * T-034 — the definition of correct for the series forms of the five lifted functions: the series
 * value at bar i equals the lifted function run on the bars up to i, for every i. The lifted
 * function is run from scratch on every prefix (O(n²) here on purpose; the code under test is not).
 * "No point" must coincide with the lifted function reporting nothing (undefined, not found, no
 * iFVG, or a NaN band).
 *
 * Fixtures:
 * - `real`: 2880 real BTCUSDT 1m bars across two UTC midnights;
 * - `walk`: a seeded synthetic walk with frequent price jumps (many FVGs, inversions and prunes, both
 *   D-03 branches), a hole spanning a whole clock hour and a midnight, a second midnight, and a
 *   zero-volume 00:01 bar;
 * - the hand-built cases of fvg.spec.ts, and a gap at bar 2 that the lifted loop skips (`i <= 2`).
 */

const MIN = 60_000;
const DAY = 86_400_000;

const realBars: Candle[] = (real.bars as number[][]).map(([openTime, open, high, low, close, volume]) => ({
  instrument: 'binance:BTCUSDT', timeframe: '1m', openTime, open, high, low, close, volume, closed: true, source: 'venue-rest',
}));

function seededWalk(): Candle[] {
  let seed = 20260921;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const bars: Candle[] = [];
  let price = 100;
  let t = Date.UTC(2024, 2, 1, 21, 0);
  for (let i = 0; i < 1800; i++) {
    if (i === 90) t += 100 * MIN; // a hole from 22:30 to 00:10: the whole 23:xx hour is missing, so 00:xx has no previous hour
    const jump = rnd() < 0.15 ? (rnd() - 0.5) * 8 : 0;
    const open = price + jump;
    const close = open + (rnd() - 0.5) * 2;
    const high = Math.max(open, close) + rnd();
    const low = Math.min(open, close) - rnd();
    const zeroVolume = t % DAY === MIN; // the 00:01 bar: the first of a VWAP day, with no volume
    bars.push(bar(t, { open, high, low, close }, zeroVolume ? 0 : 1 + Math.floor(rnd() * 10)));
    price = close;
    t += MIN;
  }
  return bars;
}
const walkBars = seededWalk();

/** fvg.spec.ts's hand-built cases (a bearish FVG inverted; a bullish one inverted), plus the bar-2 gap. */
const fvgSpecCases: Candle[][] = [
  [
    bar(0, { open: 50, high: 51, low: 49, close: 50 }),
    bar(1 * MIN, { open: 100, high: 100, low: 95, close: 98 }),
    bar(2 * MIN, { open: 96, high: 97, low: 93, close: 95 }),
    bar(3 * MIN, { open: 92, high: 94, low: 88, close: 90 }),
    bar(4 * MIN, { open: 90, high: 97, low: 85, close: 96 }),
  ],
  [
    bar(0, { open: 50, high: 51, low: 49, close: 50 }),
    bar(1 * MIN, { open: 90, high: 91, low: 85, close: 88 }),
    bar(2 * MIN, { open: 85, high: 90, low: 80, close: 85 }),
    bar(3 * MIN, { open: 92, high: 96, low: 93, close: 95 }),
    bar(4 * MIN, { open: 95, high: 97, low: 84, close: 85 }),
  ],
  [
    bar(0, { open: 100, high: 101, low: 99, close: 100 }),
    bar(1 * MIN, { open: 96, high: 97, low: 95, close: 96 }),
    bar(2 * MIN, { open: 94, high: 95, low: 93, close: 94 }), // a bearish gap against bar 0, never detected (i <= 2)
    bar(3 * MIN, { open: 96, high: 101, low: 95.5, close: 100 }), // would invert it through 99
  ],
];

const FIXTURES: [string, Candle[]][] = [
  ['real BTCUSDT 1m', realBars],
  ['seeded walk', walkBars],
  ...fvgSpecCases.map((c, k): [string, Candle[]] => [`fvg.spec case ${k + 1}`, c]),
];

/** The plug-in's bias window of the prefix `bars[0..i]` (vwap-band-reversal.windows.ts). */
function biasWindow(bars: readonly Candle[], i: number): Candle[] {
  const now = bars[i].openTime;
  const midnight = now - (now % DAY);
  return bars.slice(0, i + 1).filter((b) => b.openTime >= midnight + MIN && b.openTime <= now);
}

/**
 * The series must hold, at each bar, exactly the lifted value (`want(i)`; undefined or non-finite =
 * no point), within `rel` relative (0 = bit for bit). Returns the number of defined points.
 */
function expectParity(label: string, bars: readonly Candle[], series: IndicatorValue[], want: (i: number) => number | undefined, rel: number): number {
  const got = new Map(series.map((p) => [p.time, p.value]));
  expect({ label, points: series.length }).toEqual({ label, points: got.size }); // one point per bar at most
  let defined = 0;
  for (let i = 0; i < bars.length; i++) {
    const w = want(i);
    const g = got.get(bars[i].openTime);
    if (w === undefined || !Number.isFinite(w)) {
      if (g !== undefined) throw new Error(`${label}[${i}]: expected no point, got ${g}`);
      continue;
    }
    defined++;
    if (g === undefined || Math.abs(g - w) > rel * Math.max(1, Math.abs(w))) throw new Error(`${label}[${i}]: expected ${w}, got ${g}`);
  }
  return defined;
}

describe.each(FIXTURES)('lifted-function parity (T-034) — %s', (_name, bars) => {
  const prefix = (i: number) => bars.slice(0, i + 1);

  it.each([1, 14, 20])('atrSeries(%i)[i] = computeAtr(bars[0..i]) (1e-9 relative: a running sum)', (length) => {
    expectParity('atr', bars, atrSeries(bars, { length }).atr, (i) => computeAtr(prefix(i), length), 1e-9);
  });

  it.each([1, 5, 200])('rangeSeries(%i)[i] = computeRange(bars[0..i]) top / middle / bottom, bit for bit', (length) => {
    const s = rangeSeries(bars, { length });
    const r = (i: number) => computeRange(prefix(i), length);
    expectParity('top', bars, s.top, (i) => r(i).rangeTop, 0);
    expectParity('bottom', bars, s.bottom, (i) => r(i).rangeBottom, 0);
    expectParity('middle', bars, s.middle, (i) => {
      const { rangeTop, rangeBottom } = r(i);
      return rangeTop === undefined || rangeBottom === undefined ? undefined : (rangeTop + rangeBottom) / 2;
    }, 0);
  });

  it('previousHourSeries[i] = computePreviousHourLH(bars[0..i], openTime_i) high / low, bit for bit', () => {
    const s = previousHourSeries(bars);
    const r = (i: number) => computePreviousHourLH(prefix(i), bars[i].openTime);
    expectParity('high', bars, s.high, (i) => r(i).prevHigh, 0);
    expectParity('low', bars, s.low, (i) => r(i).prevLow, 0);
  });

  it('vwapBandSeries[i] = computeVwapBand(bias window of bars[0..i]): vwap bit for bit, band 1e-9 relative', () => {
    const s = vwapBandSeries(bars);
    const r = (i: number) => computeVwapBand(biasWindow(bars, i));
    expectParity('vwap', bars, s.vwap, (i) => r(i).vwap, 0);
    expectParity('upper', bars, s.upper, (i) => r(i).vwapTop, 1e-9);
    expectParity('lower', bars, s.lower, (i) => r(i).vwapBottom, 1e-9);
  });

  it('ifvgSeries[i] = computeFvg(bars[0..i]) last iFVG high / low, bit for bit (D-03 included)', () => {
    const s = ifvgSeries(bars);
    const r = (i: number) => computeFvg(prefix(i));
    expectParity('high', bars, s.high, (i) => r(i).ifvgHigh, 0);
    expectParity('low', bars, s.low, (i) => r(i).ifvgLow, 0);
  });
});

describe('the fixtures reach the cases that matter (T-034)', () => {
  it('the seeded walk exercises FVG inversions and pruning, both D-03 branches, the hole and the NaN band', () => {
    let bullOnly = 0; // bullish iFVG list non-empty, bearish empty
    let both = 0;
    let bearOnly = 0; // D-03: bearish iFVGs exist, yet no iFVG is reported
    for (let i = 3; i < walkBars.length; i++) {
      const f = computeFvg(walkBars.slice(0, i + 1));
      if (f.nBullIfvg > 0 && f.nBearIfvg === 0) bullOnly++;
      if (f.nBullIfvg > 0 && f.nBearIfvg > 0) both++;
      if (f.nBullIfvg === 0 && f.nBearIfvg > 0) bearOnly++;
    }
    expect({ bullOnly: bullOnly > 0, both: both > 0, bearOnly: bearOnly > 0 }).toEqual({ bullOnly: true, both: true, bearOnly: true });
    expect(new Set(ifvgSeries(walkBars).high.map((p) => p.value)).size).toBeGreaterThan(10); // the latest iFVG changes often

    const zero = walkBars.findIndex((b) => b.volume === 0);
    expect(zero).toBeGreaterThan(0);
    expect(Number.isNaN(computeVwapBand(biasWindow(walkBars, zero + 5)).vwapTop as number)).toBe(true);

    const afterHole = walkBars.findIndex((b) => b.openTime === Date.UTC(2024, 2, 2, 0, 10));
    expect(computePreviousHourLH(walkBars.slice(0, afterHole + 1), walkBars[afterHole].openTime).prevFound).toBe(false);
    expect(computePreviousHourLH(walkBars.slice(0, afterHole + 60), walkBars[afterHole + 59].openTime).prevFound).toBe(true); // 01:09 reads 00:10–00:59
  });

  it('the bar-2 gap case would show an iFVG if bar 2 were scanned', () => {
    const gap = fvgSpecCases[2];
    expect(computeFvg(gap).hasIfvg).toBe(false);
    expect(computeFvg([bar(-MIN, { open: 0, high: 0, low: 0, close: 0 }), ...gap]).hasIfvg).toBe(true); // shifted to bar 3, it is
  });

  it('the real slice has an iFVG on some bars and not on others, and spans two midnights', () => {
    const s = ifvgSeries(realBars);
    expect(s.high.length).toBeGreaterThan(0);
    expect(s.high.length).toBeLessThan(realBars.length);
    expect(realBars.filter((b) => b.openTime % DAY === 0)).toHaveLength(2);
  });
});
