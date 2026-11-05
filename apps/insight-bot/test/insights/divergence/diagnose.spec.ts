import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, OI_DIVERGENCE_TFS } from '@trade-automation/contracts';
import { barsForEvaluation, detectDivergences, type Bar, type DivergenceInput, type DivergenceParams } from '../../../src/insights/divergence/detector';
import { diagnose, nearMissReach, type NearMiss } from '../../../src/insights/divergence/diagnose';
import { detectorParams } from '../../../src/insights/divergence/params';
import type { OiPoint } from '../../../src/insights/divergence/oi-per-bar';

/**
 * IB-115 (V26) — near-misses. Scenes are the detector spec's (detector.spec.ts): wick lows with high = low + 2,
 * OI alternating 1000/1010 (median |ΔOI| 10, no OI pivots of its own), and every scene also runs mirrored
 * (bearish, on highs). For each of the six rules: a miss inside the reach is recorded with its rule and amount;
 * just beyond the reach it is not; and inside the reach with a SECOND rule failing it is not either.
 */
const TF = 900;
const T0 = 1_793_000_000 - (1_793_000_000 % TF);
const P: DivergenceParams = { nLeft: 6, nRight: 6, k: 3, w: 96, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 };
const O = 60;

type OiCell = number | [number, number, number];
function scene(len: number, set: Record<number, { low?: number; oi?: OiCell }>) {
  return {
    lows: Array.from({ length: len }, (_, i) => set[i]?.low ?? 100),
    oi: Array.from({ length: len }, (_, i): OiCell => set[i]?.oi ?? [1000, 1010][i % 2]),
  };
}
function input(s: ReturnType<typeof scene>, mirror: boolean, params: DivergenceParams = P): DivergenceInput {
  const bars: Bar[] = s.lows.map((low, i) => {
    const lo = mirror ? 200 - (low + 2) : low;
    return { time: T0 + i * TF, open: lo + 1, high: lo + 2, low: lo, close: lo + 1 };
  });
  const oi5m: OiPoint[] = s.oi.flatMap((v, i) => (typeof v === 'number' ? [v, v, v] : v)
    .map((x, k) => ({ time: T0 + i * TF + (k + 1) * 300, oi: mirror ? 2020 - x : x })));
  return { tfSec: TF, bars, oi5m, params };
}
/** Near-misses at B (and the detections), bullish and mirrored. */
function at(s: ReturnType<typeof scene>, b: number, check: (m: NearMiss[], detected: number, dir: string) => void, params: DivergenceParams = P) {
  for (const mirror of [false, true]) {
    const inp = input(s, mirror, params);
    const r = detectDivergences(inp);
    check(diagnose(inp, r).filter((m) => m.bIndex === b), r.divergences.filter((d) => d.bIndex === b).length, mirror ? 'bearish' : 'bullish');
  }
}
const one = (rule: string, miss: number, aIndex?: number) => (m: NearMiss[], detected: number, dir: string) => {
  expect(detected).toBe(0);
  expect(m.map((x) => [x.direction, x.rule])).toEqual([[dir, rule]]);
  expect(m[0].miss).toBeCloseTo(miss, 6);
  if (aIndex !== undefined) expect(m[0].aIndex).toBe(aIndex);
};
const none = (m: NearMiss[], detected: number) => {
  expect(detected).toBe(0);
  expect(m).toEqual([]);
};

// The base: A at O+40 (low 95, its OI pivot 960 a bar later), B at O+60 (low 93, OI 980) — a clean divergence.
const A = O + 40;
const B = O + 60;
const base = (set: Record<number, { low?: number; oi?: OiCell }> = {}) => scene(O + 90, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 }, ...set });

describe('diagnose — near-misses (IB-115, V26)', () => {
  it('control: the clean divergence is detected, so B has NO near-miss («only when B produced no alert»)', () => {
    at(base(), B, (m, detected) => {
      expect(detected).toBe(1);
      expect(m).toEqual([]);
    });
    // a second A at W + 1 fails only W — it would be a near-miss of B, but B was detected (from A): still none
    const b = O + 160;
    const twoA = scene(b + 30, { [b - 97]: { low: 96 }, [b - 96]: { oi: 950 }, [b - 20]: { low: 95 }, [b - 19]: { oi: 972 }, [b]: { low: 93, oi: 980 } }); // 972: 2 under the far A’s OI line, inside its tolerance 5
    at(twoA, b, (m, detected) => {
      expect(detected).toBe(1);
      expect(m).toEqual([]);
    });
    // control: without the detected A, the W + 1 one IS the near-miss — so the «none» above is the rule's
    const alone = scene(b + 30, { [b - 97]: { low: 96 }, [b - 96]: { oi: 950 }, [b]: { low: 93, oi: 980 } });
    at(alone, b, one('w', 1, b - 97));
  });

  // δp ≈ 0.58 at B (detector spec 8: ATR14 ≈ 2.3 × 0.25)
  it('price_delta: worse by 0.2 of δp ≈ 0.58 is a near-miss; NOT worse at all (beyond reach) is not; with OI also inside δoi it is not', () => {
    for (const mirror of [false, true]) {
      const inp = input(base({ [B]: { low: 94.8, oi: 980 } }), mirror);
      const m = diagnose(inp, detectDivergences(inp)).filter((x) => x.bIndex === B);
      expect(m.map((x) => x.rule)).toEqual(['price_delta']);
      expect(m[0].unit).toBe('threshold');
      expect(m[0].miss).toBeGreaterThan(0.6); // (δp − 0.2) ÷ δp
      expect(m[0].miss).toBeLessThan(0.7);
    }
    at(base({ [B]: { low: 95.2, oi: 980 } }), B, none); // higher than A: «worse by at least 0» fails
    at(base({ [B]: { low: 94.8, oi: 963 } }), B, none); // and OI inside δoi: two rules
  });

  it('oi_delta: OI better by 3 of δoi 5 → miss 0.4; worse than A (beyond reach) → none; with the price also inside δp → none', () => {
    at(base({ [B]: { low: 93, oi: 963 } }), B, one('oi_delta', 0.4, A));
    at(base({ [B]: { low: 93, oi: 955 } }), B, none);
    at(base({ [B]: { low: 94.8, oi: 963 } }), B, none);
  });

  // the V18 scene: A low 74 (OI 960) at O+20, B low 70 (OI 980) at O+60 → the price line is 72 at O+40, the OI line 970
  const A2 = O + 20;
  const B2 = O + 60;
  const J = O + 40;
  const v18 = (set: Record<number, { low?: number; oi?: OiCell }>) => scene(O + 90, { [A2]: { low: 74, oi: 960 }, [B2]: { low: 70, oi: 980 }, ...set });

  it('price_line: a wick 1.5 under the line (tolerance ≈ 1.01) is a near-miss in ATR14; 2.5 under (beyond 2 tolerances) is not; with OI inside δoi, not', () => {
    // ATR14 at J = (13 × 2 + (101 − wick)) / 14; tolerance 0.25 × that
    const atr = (26 + 101 - 70.5) / 14;
    at(v18({ [J]: { low: 70.5 } }), B2, one('price_line', (1.5 - 0.25 * atr) / atr, A2));
    at(v18({ [J]: { low: 69.6 } }), B2, none); // 2.4 under; 2 × 0.25 × 4.1 ≈ 2.05
    at(v18({ [J]: { low: 70.5 }, [B2]: { low: 70, oi: 963 } }), B2, none);
    // round 1 (tolerance 0) has no reach: the same wick is a plain refusal, not a near-miss
    at(v18({ [J]: { low: 70.5 } }), B2, none, { ...P, priceLineTolAtrMult: 0 });
  });

  it('oi_line: a per-bar OI 8 under the OI line (tolerance 5) → miss 0.3 medians; 10.5 under → none; with the price inside δp → none', () => {
    at(v18({ [J]: { oi: [1000, 962, 1000] } }), B2, one('oi_line', 0.3, A2));
    at(v18({ [J]: { oi: [1000, 959.5, 1000] } }), B2, none);
    at(v18({ [J]: { oi: [1000, 962, 1000] }, [B2]: { low: 73.9, oi: 980 } }), B2, none);
  });

  it('k: B’s OI pivot at k + 1 → miss 1 bar; at 2k + 1 → none; at k + 1 with the price inside δp → none', () => {
    at(base({ [B]: { low: 93 }, [B + 4]: { oi: 980 } }), B, one('k', 1, A));
    at(base({ [B]: { low: 93 }, [B + 6]: { oi: 980 } }), B, one('k', 3, A)); // 2k: the edge of the reach
    at(base({ [B]: { low: 93 }, [B + 7]: { oi: 980 } }), B, none);
    at(base({ [B]: { low: 94.8 }, [B + 4]: { oi: 980 } }), B, none);
  });

  it('w: A at W + 1 → miss 1 bar; at ⌊1.5 W⌋ = 144 → miss 48; at 145 → none; at W + 1 with the price inside δp → none', () => {
    const wScene = (span: number, bLow = 93) => {
      const b = O + 160;
      return { b, s: scene(b + 30, { [b - span]: { low: 95 }, [b - span + 1]: { oi: 960 }, [b]: { low: bLow, oi: 980 } }) };
    };
    for (const [span, miss] of [[97, 1], [144, 48]] as const) {
      const { b, s } = wScene(span);
      at(s, b, one('w', miss, b - span));
    }
    const far = wScene(145);
    at(far.s, far.b, none);
    const two = wScene(97, 94.8);
    at(two.s, two.b, none);
  });

  it('several A: the smallest miss RELATIVE to its reach wins (W 1 of 48 beats δoi 0.4 of 1); one row per B', () => {
    const b = O + 160;
    const s = scene(b + 30, {
      [b - 97]: { low: 95 }, [b - 96]: { oi: 960 }, // W + 1: miss 1 / 48 ≈ 0.02
      [b - 20]: { low: 94 }, [b - 19]: { oi: 977 }, // OI better by 3 of 5 at B: miss 0.4 / 1
      [b]: { low: 92, oi: 980 },
    });
    at(s, b, one('w', 1, b - 97));
  });

  it('a hole in OI inside B’s reach: B is not judged, no near-miss', () => {
    const s = base({ [B]: { low: 93, oi: 963 } });
    for (const mirror of [false, true]) {
      const inp = input(s, mirror);
      const holeSlot = T0 + (A - 10) * TF + 600;
      const holed = { ...inp, oi5m: inp.oi5m.filter((x) => x.time !== holeSlot) };
      expect(diagnose(holed, detectDivergences(holed)).filter((m) => m.bIndex === B)).toEqual([]);
      expect(diagnose(inp, detectDivergences(inp)).filter((m) => m.bIndex === B)).toHaveLength(1); // control
    }
  });
});

/**
 * V26 «включение diagnose не меняет ни одной детекции» on the same real data: dev-1's two committed real
 * cases. diagnose reads the result; the result after it is deep-equal to one computed without it.
 */
describe('diagnose on real data changes no detection', () => {
  it.each(['oi-divergence-ethusdt-1h-bullish.json', 'oi-divergence-solusdt-1h-bearish.json'])('%s', (file) => {
    const f = JSON.parse(readFileSync(join(__dirname, '../../fixtures/binance', file), 'utf8')) as { tfSec: number; bars: Bar[]; oi5m: OiPoint[] };
    const params = detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, '1h');
    const inp: DivergenceInput = { tfSec: f.tfSec, bars: f.bars, oi5m: f.oi5m, params };
    const without = detectDivergences(inp);
    const r = detectDivergences(inp);
    const frozen = JSON.stringify(r);
    const misses = diagnose(inp, r);
    expect(JSON.stringify(r)).toBe(frozen);
    expect(r).toEqual(without);
    expect(r.divergences.length).toBeGreaterThan(0); // the real case is in there
    // no near-miss on a detected B, at most one per (direction, B)
    const detected = new Set(r.divergences.map((d) => `${d.direction}:${d.bIndex}`));
    expect(misses.filter((m) => detected.has(`${m.direction}:${m.bIndex}`))).toEqual([]);
    const keys = misses.map((m) => `${m.direction}:${m.bIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * V26 bars: the reach widens the basis to `barsForEvaluation(nearMissReach(p))`. On each TF's defaults the scene
 * puts the newest B a near-miss can be judged at (its OI pivot 2k after it, confirmed N later = the last bar) and
 * its A ⌊1.5 W⌋ back (a W near-miss), with the first crossable bar after A dipping inside its ATR tolerance.
 * With exactly that many bars it is found; with one fewer it is not.
 */
describe('barsForEvaluation(nearMissReach) — the minimum bars for the farthest near-miss', () => {
  it('derives 164 / 272 / 151 (+ the alert W tail: 260 / 440 / 241 fetched, weight 2; 4h 6/2 since IB-141)', () => {
    const counts = OI_DIVERGENCE_TFS.map((tf) => barsForEvaluation(nearMissReach(OI_DIVERGENCE_DEFAULT_PARAMS.perTf[tf])));
    expect(counts).toEqual([164, 272, 151]);
    const fetched = OI_DIVERGENCE_TFS.map((tf, i) => counts[i] + OI_DIVERGENCE_DEFAULT_PARAMS.perTf[tf].w);
    expect(fetched).toEqual([260, 440, 241]);
    expect(fetched.every((c) => c >= 100 && c < 500)).toBe(true);
  });

  it.each(OI_DIVERGENCE_TFS)('%s: that many bars finds the farthest near-miss; one fewer does not', (tf) => {
    const tfSec = OI_DIVERGENCE_TF_SEC[tf];
    const p = detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, tf);
    const reach = nearMissReach(p);
    const len = barsForEvaluation(reach);
    const b = len - 1 - reach.k - p.nRight;
    const a = b - reach.w;
    const j = a + Math.max(p.nLeft, p.nRight) + 1; // V36: A holds max(nLeft, nRight) bars on its right

    const lineJ = 95 + ((93 - 95) * (j - a)) / (b - a);
    const t0 = 1_793_000_000 - (1_793_000_000 % 14_400);
    const lowAt = (i: number) => (i === a ? 95 : i === b ? 93 : i === j ? lineJ - 0.3 : 100);
    const oiAt = (i: number) => (i === a ? 960 : i === b ? 980 : 1000 + 10 * (i % 2));
    const bars = Array.from({ length: len }, (_, i) => ({ time: t0 + i * tfSec, open: lowAt(i) + 1, high: lowAt(i) + 2, low: lowAt(i), close: lowAt(i) + 1 }));
    const per = tfSec / 300;
    const oi5m = Array.from({ length: len }, (_, i) => Array.from({ length: per }, (_, s) => ({ time: t0 + i * tfSec + (s + 1) * 300, oi: oiAt(i) }))).flat();
    const found = (from: number) => {
      const inp = { tfSec, bars: bars.slice(from), oi5m, params: p };
      return diagnose(inp, detectDivergences(inp)).filter((m) => m.b.time === bars[b].time && m.a.time === bars[a].time);
    };
    expect(found(0).map((m) => [m.rule, m.miss])).toEqual([['w', reach.w - p.w]]);
    expect(found(1)).toEqual([]);
  });
});

/**
 * IB-141 (V35): the near-miss hole window is [B − ⌊1.5 W⌋ − nLeft, B + 2k + nRight], on sides that differ (6/2), so a
 * swapped side moves an edge by 4 bars. The scene: B (low 93, OI 962) fails only δoi against A (95, 960) — a near-miss.
 */
describe('diagnose — the hole window with unequal sides (IB-141)', () => {
  const P62: DivergenceParams = { ...P, nRight: 2 };
  const NB = 200;
  const NA = NB - 20;
  const judged = (holeBar: number) => {
    const s = scene(NB + 30, { [NA]: { low: 95 }, [NA + 1]: { oi: 960 }, [NB]: { low: 93, oi: 962 } });
    const inp = input(s, false, P62);
    const cut = { ...inp, oi5m: inp.oi5m.filter((x) => x.time !== T0 + holeBar * TF + 600) };
    return diagnose(cut, detectDivergences(cut)).filter((m) => m.bIndex === NB).map((m) => m.rule);
  };
  it('control: with no hole, B is the oi_delta near-miss', () => expect(judged(-1)).toEqual(['oi_delta']));
  it('the far edge: a hole in bar B − ⌊1.5 W⌋ − nLeft voids it, one bar earlier does not', () => {
    expect([judged(NB - 144 - 6), judged(NB - 144 - 6 - 1)]).toEqual([[], ['oi_delta']]);
  });
  it('the near edge: a hole in bar B + 2k + nRight voids it, one bar later does not', () => {
    expect([judged(NB + 6 + 2), judged(NB + 6 + 2 + 1)]).toEqual([[], ['oi_delta']]);
  });
});
