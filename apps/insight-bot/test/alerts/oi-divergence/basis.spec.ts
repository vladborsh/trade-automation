import { OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, type OiDivergenceTf } from '@trade-automation/contracts';
import { barsToFetch, fullBasisIndex, hasFullBasis } from '../../../src/alerts/oi-divergence/basis';
import { detectDivergences, type Bar, type DivergenceParams } from '../../../src/insights/divergence/detector';

/** IB-112 (V10, TL and dev-1 2026-11-04) — the loop reads the detector's own count, and guards B at its edge. */
const P = OI_DIVERGENCE_DEFAULT_PARAMS.perTf;
const params = (tf: OiDivergenceTf): DivergenceParams => ({ ...P[tf], atrMult: OI_DIVERGENCE_DEFAULT_PARAMS.atrMult, oiMedianMult: OI_DIVERGENCE_DEFAULT_PARAMS.oiMedianMult });

describe('bars the loop reads', () => {
  it('the detector\'s barsForEvaluation: 112 / 136 / 111 with the defaults — never typed', () => {
    expect([barsToFetch(P['15m']), barsToFetch(P['1h']), barsToFetch(P['4h'])]).toEqual([112, 136, 111]);
    expect([fullBasisIndex(P['15m']), fullBasisIndex(P['1h']), fullBasisIndex(P['4h'])]).toEqual([102, 126, 101]);
  });
});

describe('the newest B the loop must catch: full basis with exactly that many bars, not with one fewer', () => {
  for (const tf of ['15m', '1h', '4h'] as const) {
    it(tf, () => {
      const p = P[tf];
      const newestB = (count: number) => count - 1 - p.k - p.n;
      expect(hasFullBasis(newestB(barsToFetch(p)), p)).toBe(true);
      expect(hasFullBasis(newestB(barsToFetch(p) - 1), p)).toBe(false);
    });
  }
  it('111 bars on 15m (the first hand-typed count) is short', () => {
    expect(hasFullBasis(111 - 1 - P['15m'].k - P['15m'].n, P['15m'])).toBe(false);
  });
});

/**
 * Against the REAL detector: on a seeded random walk, every divergence whose B passes the guard in the
 * loop's window is found exactly as on 600 bars of history (same A, same B, same run). This is what
 * the count is FOR: the alert must be the line the chart draws from longer history.
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
      for (let seed = 1; seed <= 40; seed++) {
        const { bars, oi5m } = walk(seed, 600, tfSec);
        const long = detectDivergences({ tfSec, bars, oi5m, params: p });
        // slide the loop's window over the history: each end position is one evaluation
        for (let end = count; end <= bars.length; end += 37) {
          const win = bars.slice(end - count, end);
          const from = win[0].time;
          const to = win[win.length - 1].time + tfSec;
          const short = detectDivergences({ tfSec, bars: win, oi5m: oi5m.filter((o) => o.time > from && o.time <= to), params: p });
          const guarded = short.divergences.filter((d) => hasFullBasis(d.bIndex, p) && d.confirmedAt <= to);
          for (const d of guarded) {
            const twin = long.divergences.find((l) => l.direction === d.direction && l.b.time === d.b.time);
            expect(twin && key(twin)).toBe(key(d));
            compared++;
          }
        }
      }
      expect(compared).toBeGreaterThan(0); // the comparison ran on real cases, not on nothing
    });
  }
});
