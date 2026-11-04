import { OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, type OiDivergenceTf } from '@trade-automation/contracts';
import { barsToFetch, fullBasisIndex, hasFullBasis, minBarsToEvaluate } from '../../../src/alerts/oi-divergence/basis';
import { barsForEvaluation, detectDivergences, type Bar, type DivergenceParams } from '../../../src/insights/divergence/detector';
import { detectorParams } from '../../../src/insights/divergence/params';

/** IB-112 (V10, TL and dev-1 2026-11-04) — the loop reads the detector's own count, and guards B at its edge. */
const P = OI_DIVERGENCE_DEFAULT_PARAMS.perTf;
/** The round-2 defaults, line tolerances ON (IB-114): the window must agree with long history under them too. */
const params = (tf: OiDivergenceTf): DivergenceParams => detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, tf);

const TFS = ['15m', '1h', '4h'] as const;

describe('bars the loop reads', () => {
  it('evaluates from the detector\'s barsForEvaluation (113 / 185 / 111) and reads W more (209 / 353 / 201) — weight 2 each, never typed', () => {
    expect(TFS.map((tf) => minBarsToEvaluate(P[tf]))).toEqual(TFS.map((tf) => barsForEvaluation(P[tf])));
    expect(TFS.map((tf) => minBarsToEvaluate(P[tf]))).toEqual([113, 185, 111]);
    expect(TFS.map((tf) => barsToFetch(P[tf]))).toEqual([209, 353, 201]);
    expect(TFS.every((tf) => barsToFetch(P[tf]) >= 100 && barsToFetch(P[tf]) < 500)).toBe(true); // klines limit 100–499: weight 2
    // the guard is the newest confirmable position of whatever the window holds, never before the full-basis index
    expect(TFS.map((tf) => fullBasisIndex(P[tf], barsToFetch(P[tf])))).toEqual([199, 343, 191]);
    expect(TFS.map((tf) => fullBasisIndex(P[tf], minBarsToEvaluate(P[tf])))).toEqual([103, 175, 101]);
  });
});

describe('the newest B the loop must catch: full basis from exactly barsForEvaluation bars, not one fewer', () => {
  for (const tf of TFS) {
    it(tf, () => {
      const p = P[tf];
      const newestB = (count: number) => count - 1 - p.k - p.n;
      for (const len of [minBarsToEvaluate(p), barsToFetch(p)]) expect([len, hasFullBasis(newestB(len), p, len)]).toEqual([len, true]);
      const short = minBarsToEvaluate(p) - 1;
      expect(hasFullBasis(newestB(short), p, short)).toBe(false);
      expect(hasFullBasis(newestB(barsToFetch(p)) - 1, p, barsToFetch(p))).toBe(false); // an older B: an earlier evaluation's
    });
  }
  it('111 bars on 15m (the first hand-typed count) is short', () => {
    expect(hasFullBasis(111 - 1 - P['15m'].k - P['15m'].n, P['15m'], 111)).toBe(false);
  });
});

/**
 * IB-114 — why the loop reads W more than barsForEvaluation: a repeat A, B′, B (V8) with B′ halfway, B the
 * newest B of the window. With barsForEvaluation bars B′ falls before the 100-move noise context, is never
 * judged, and B looks like a first alert; with the extra W it is judged and B is «третий подряд», as the chart
 * draws it from all history. B′ sits ON the A–B price and OI lines (a run's middle pivot must not cross them).
 */
describe('a repeat\'s earlier line needs its own basis: the + W', () => {
  it.each(TFS)('%s', (tf) => {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const p = params(tf);
    const t0 = 1_793_000_000 - (1_793_000_000 % 14_400);
    const runLengthAtB = (len: number): number | undefined => {
      const b = len - 1 - p.n; // OI pivot on B itself: confirmed N bars later, by the last bar
      const a = b - p.w;
      const mid = a + p.w / 2; // W is even on every TF
      const lowAt = (i: number) => (i === a ? 95 : i === mid ? 93 : i === b ? 91 : 100);
      const oiAt = (i: number) => (i === a ? 960 : i === mid ? 975 : i === b ? 990 : 1000 + 10 * (i % 2));
      const bars = Array.from({ length: len }, (_, i) => ({ time: t0 + i * tfSec, open: lowAt(i) + 1, high: lowAt(i) + 2, low: lowAt(i), close: lowAt(i) + 1 }));
      const oi5m = Array.from({ length: len }, (_, i) => Array.from({ length: tfSec / 300 }, (_, j) => ({ time: t0 + i * tfSec + (j + 1) * 300, oi: oiAt(i) }))).flat();
      const d = detectDivergences({ tfSec, bars, oi5m, params: p }).divergences.find((x) => x.bIndex === b && hasFullBasis(x.bIndex, p, len));
      return d && d.aIndex === a ? d.runLength : undefined;
    };
    expect(runLengthAtB(barsToFetch(p))).toBe(3);
    expect(runLengthAtB(minBarsToEvaluate(p))).toBe(2); // the defect the + W removes: same A and B, the run lost
  });
});

/**
 * Against the REAL detector: on a seeded random walk, every divergence whose B passes the guard in the
 * loop's window is found exactly as on the whole walk (same A, same B, same run). This is what
 * the count is FOR: the alert must be the line the chart draws from longer history — including its run (V8).
 */
function walk(seed: number, count: number, tfSec: number): { bars: Bar[]; oi5m: { time: number; oi: number }[] } {
  let s = seed;
  const rnd = () => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const t0 = 1_790_000_000 - (1_790_000_000 % tfSec);
  const bars: Bar[] = [];
  const oi5m: { time: number; oi: number }[] = [];
  let price = 100;
  let oi = 1_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    price *= 1 + (rnd() - 0.5) * 0.02;
    const high = Math.max(open, price) * (1 + rnd() * 0.004);
    const low = Math.min(open, price) * (1 - rnd() * 0.004);
    bars.push({ time: t0 + i * tfSec, open, high, low, close: price });
    for (let m = 300; m <= tfSec; m += 300) {
      oi *= 1 + (rnd() - 0.5) * 0.01;
      oi5m.push({ time: t0 + i * tfSec + m, oi });
    }
  }
  return { bars, oi5m };
}

describe('the window agrees with long history for every guarded B (real detector)', () => {
  for (const tf of ['15m', '1h', '4h'] as const) {
    it(tf, () => {
      const tfSec = OI_DIVERGENCE_TF_SEC[tf];
      const p = params(tf);
      const count = barsToFetch(p);
      const key = (d: { direction: string; a: { time: number }; b: { time: number }; runLength: number }) => `${d.direction} ${d.a.time} ${d.b.time} ${d.runLength}`;
      let compared = 0;
      let repeats = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const { bars, oi5m } = walk(seed, count + 600, tfSec); // 600 window ends past the first full window
        const long = detectDivergences({ tfSec, bars, oi5m, params: p });
        // slide the loop's window over the history: each end position is one evaluation
        // step 5 over 20 walks (was 37 over 40: 2–10 lines per TF, and it missed the run defect, which this catches on
        // 15m and 4h with the old window; every bar: ~3 min)
        for (let end = count; end <= bars.length; end += 5) {
          const win = bars.slice(end - count, end);
          const from = win[0].time;
          const to = win[win.length - 1].time + tfSec;
          const per = tfSec / 300; // walk() writes exactly this many readings per bar, in order: a slice is (from, to]
          const winOi = oi5m.slice((end - count) * per, end * per);
          expect([winOi[0].time > from, winOi[winOi.length - 1].time === to]).toEqual([true, true]);
          const short = detectDivergences({ tfSec, bars: win, oi5m: winOi, params: p });
          const guarded = short.divergences.filter((d) => hasFullBasis(d.bIndex, p, win.length) && d.confirmedAt <= to);
          for (const d of guarded) {
            const twin = long.divergences.find((l) => l.direction === d.direction && l.b.time === d.b.time);
            expect(twin && key(twin)).toBe(key(d));
            compared++;
            if (d.runLength > 2) repeats++;
          }
        }
      }
      // the comparison ran on real cases, not on nothing — and on runs, which are what a short window gets wrong
      expect(compared).toBeGreaterThanOrEqual(10); // measured 12 / 20 / 25 on 15m / 1h / 4h
      expect(repeats).toBeGreaterThan(0);
    });
  }
});
