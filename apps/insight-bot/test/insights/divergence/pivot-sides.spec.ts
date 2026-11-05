import { aEligibility, bOiHolds, detectDivergences, type Bar, type DivergenceInput, type DivergenceParams, type PivotPair } from '../../../src/insights/divergence/detector';
import { diagnose } from '../../../src/insights/divergence/diagnose';
import { oiPerBar, type OiPoint } from '../../../src/insights/divergence/oi-per-bar';
import { pivots } from '../../../src/insights/divergence/pivots';

/**
 * IB-141 (architecture/oi-divergence-design-2026-11-04.md §10, V34–V36) — the pivot reach has two sides. Every
 * use of N in the detector is one side or the other (V35), and each is pinned here with sides that DIFFER (6 left,
 * 2 right, as 4h): with equal sides a use on the wrong side passes every spec, so each one below fails if its side
 * is swapped. V36 («fast B, full A») is pinned with a false bottom that 6/2 would otherwise pair.
 *
 * Every scenario runs bullish (lows) and mirrored bearish (highs), as in detector.spec.ts.
 */
const TF = 900;
const T0 = 1_793_000_000 - (1_793_000_000 % TF);
const P62: DivergenceParams = { nLeft: 6, nRight: 2, k: 3, w: 96, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 };
const BASE_OI = [1000, 1010];

interface Scene {
  lows: number[];
  oi: number[];
  drop?: Array<[number, number]>;
}

function scene(len: number, set: Record<number, { low?: number; oi?: number }> = {}): Scene {
  return {
    lows: Array.from({ length: len }, (_, i) => set[i]?.low ?? 100),
    oi: Array.from({ length: len }, (_, i) => set[i]?.oi ?? BASE_OI[i % 2]),
  };
}

function input(s: Scene, mirror: boolean, extra: Partial<DivergenceInput> = {}): DivergenceInput {
  const bars: Bar[] = s.lows.map((low, i) => {
    const lo = mirror ? 200 - (low + 2) : low;
    return { time: T0 + i * TF, open: lo + 1, high: lo + 2, low: lo, close: lo + 1 };
  });
  const drop = new Set((s.drop ?? []).map(([b, k]) => `${b}:${k}`));
  const oi5m: OiPoint[] = s.oi.flatMap((v, i) => [0, 1, 2]
    .map((k) => ({ time: T0 + i * TF + (k + 1) * 300, oi: mirror ? 2020 - v : v }))
    .filter((_, k) => !drop.has(`${i}:${k}`)));
  return { tfSec: TF, bars, oi5m, params: P62, ...extra };
}

function both(s: Scene, check: (r: ReturnType<typeof detectDivergences>, mirror: boolean) => void, extra?: Partial<DivergenceInput>) {
  for (const mirror of [false, true]) check(detectDivergences(input(s, mirror, extra)), mirror);
}

const lines = (r: ReturnType<typeof detectDivergences>) => r.divergences.map((d) => [d.aIndex, d.bIndex]);

/** O baseline bars first: B needs its 100 OI moves (V7). */
const O = 60;
const A = O + 40;
const B = O + 60;
/** A at A (low 95, OI pivot 960 a bar later), B at B (low 93, OI 980): a clean divergence under 6/2. */
const base = () => scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 } });

describe('pivots() — nLeft bars before, strict; nRight after, not strict (V5, V34)', () => {
  const v = (len: number, set: Record<number, number>) => Array.from({ length: len }, (_, i) => set[i] ?? 10);

  it('a 6/2 pivot exists once nRight = 2 bars follow it, with nLeft = 6 before; 2/6 (the sides swapped) does not', () => {
    expect(pivots(v(9, { 6: 5 }), 6, 2, 'low')).toEqual([6]);
    expect(pivots(v(8, { 6: 5 }), 6, 2, 'low')).toEqual([]); // bar 8 not closed yet
    expect(pivots(v(9, { 6: 5 }), 2, 6, 'low')).toEqual([]);
    expect(pivots(v(9, { 2: 5 }), 6, 2, 'low')).toEqual([]); // the first candidate is i = nLeft, not nRight
    expect(pivots(v(9, { 2: 5 }), 2, 6, 'low')).toEqual([2]);
  });

  it('the left side reaches exactly nLeft back, the right exactly nRight forward', () => {
    expect(pivots(v(30, { 16: 5, 10: 4 }), 6, 2, 'low')).toEqual([10]); // a lower bar 6 back refuses 16
    expect(pivots(v(30, { 16: 5, 9: 4 }), 6, 2, 'low')).toEqual([9, 16]); // 7 back does not
    expect(pivots(v(30, { 16: 5, 18: 4 }), 6, 2, 'low')).toEqual([18]); // a lower bar 2 forward refuses 16
    expect(pivots(v(30, { 16: 5, 19: 4 }), 6, 2, 'low')).toEqual([16, 19]); // 3 forward does not: 6/2's false bottom
  });

  it('highs mirror it', () => {
    expect(pivots(v(30, { 16: 15, 10: 16 }), 6, 2, 'high')).toEqual([10]);
    expect(pivots(v(30, { 16: 15, 19: 16 }), 6, 2, 'high')).toEqual([16, 19]);
  });
});

describe('the detector with 6 left / 2 right (V35)', () => {
  it('pair confirmation is max(price, OI) + nRight: B confirms at the close of bar B + 2, A at A + 1 + 2', () => {
    both(base(), (r) => {
      expect(lines(r)).toEqual([[A, B]]);
      expect(r.pairs.map((p) => [p.price, p.confirmIndex])).toEqual([[A, A + 3], [B, B + 2]]);
      expect(r.divergences[0].confirmedAt).toBe(T0 + (B + 3) * TF);
    });
  });

  it('a pivot is not a pivot until bar i + nRight has closed: B + 1 is not enough, B + 2 is', () => {
    for (const mirror of [false, true]) {
      const full = input(base(), mirror);
      const cut = (last: number) => detectDivergences({ ...full, bars: full.bars.slice(0, last + 1) });
      expect(lines(cut(B + 1))).toEqual([]);
      expect(lines(cut(B + 2))).toEqual([[A, B]]);
    }
  });

  // V9's window [B − W − nLeft, B + k + nRight]; a bar owns its slots (open, close]
  const skipsAtB = (r: ReturnType<typeof detectDivergences>) => r.skips.filter((x) => x.barTime === T0 + B * TF).length;
  it('V9: a hole in bar B + k + nRight skips B; one bar later does not', () => {
    both({ ...base(), drop: [[B + 3 + 2, 1]] }, (r) => expect(skipsAtB(r)).toBe(1));
    both({ ...base(), drop: [[B + 3 + 2 + 1, 1]] }, (r) => {
      expect(skipsAtB(r)).toBe(0);
      expect(lines(r)).toEqual([[A, B]]);
    });
  });

  it('V9: a hole in bar B − W − nLeft skips B; one bar earlier does not', () => {
    both({ ...base(), drop: [[B - 96 - 6, 1]] }, (r) => expect(skipsAtB(r)).toBe(1));
    both({ ...base(), drop: [[B - 96 - 6 - 1, 1]] }, (r) => expect(skipsAtB(r)).toBe(0));
  });
});

/**
 * V36 — the false bottom. A low at X (95, its OI pivot 960 there too) holds 2 bars on the right, so 6/2 calls it a
 * pivot; 4 bars later price trades lower (93, OI 980 three bars after that). Under 6/6 X would never have been a
 * pivot. Without V36 the two would make a «divergence» across a false bottom and the real one.
 */
describe('V36: fast B, full A', () => {
  const X = O + 40;
  const falseBottom = () => scene(O + 80, { [X]: { low: 95, oi: 960 }, [X + 4]: { low: 93 }, [X + 7]: { oi: 980 } });
  const realBottom = () => scene(O + 80, { [X]: { low: 95, oi: 960 }, [X + 7]: { low: 93, oi: 980 } });

  it('a 6/2 pivot contradicted 3–6 bars later cannot be A; without V36 (`fast`) it would be', () => {
    both(falseBottom(), (r) => expect(lines(r)).toEqual([]));
    both(falseBottom(), (r) => expect(lines(r)).toEqual([[X, X + 4]]), { aRule: 'fast' }); // control: the rule refused it
  });

  it('control: the same A with the lower low beyond its 6 right bars is a full pivot and pairs', () => {
    both(realBottom(), (r) => expect(lines(r)).toEqual([[X, X + 7]]));
  });

  it('B keeps the fast nRight: the real bottom is confirmed at X + 7 + 2, not + 6', () => {
    both(realBottom(), (r) => expect(r.divergences[0].confirmedAt).toBe(T0 + (X + 7 + 2 + 1) * TF));
  });

  it('with equal sides the rule changes nothing (15m, 1h): full and fast find the same lines on a random walk', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const bars: Bar[] = [];
    const oi5m: OiPoint[] = [];
    let px = 100;
    let oi = 1_000;
    for (let i = 0; i < 1_500; i++) {
      px += rnd() - 0.5;
      oi += (rnd() - 0.5) * 20;
      bars.push({ time: T0 + i * TF, open: px + 1, high: px + 2, low: px, close: px + 1 });
      for (let k = 1; k <= 3; k++) oi5m.push({ time: T0 + i * TF + k * 300, oi: oi + (rnd() - 0.5) * 4 });
    }
    const run = (nRight: number, aRule: 'full' | 'fast') => detectDivergences({
      tfSec: TF, bars, oi5m, aRule, params: { ...P62, nLeft: 6, nRight, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 },
    }).divergences;
    expect(run(6, 'full').length).toBeGreaterThan(0); // the walk does produce lines, so equality says something
    expect(run(6, 'full')).toEqual(run(6, 'fast'));
    // and on the same walk at 6/2 the rule does remove some: it is not a no-op there
    expect(run(2, 'full').length).toBeLessThan(run(2, 'fast').length);
  });

  it('A is judged only on bars up to B’s confirmation: its price and OI pivots need max(nLeft, nRight) bars there', () => {
    const values = Array.from({ length: 30 }, (_, i) => (i === 10 ? 95 : 100));
    const oiValues = Array.from({ length: 30 }, (_, i) => (i === 11 ? 960 : 1000));
    const can = aEligibility({ nLeft: 6, nRight: 2 }, { low: values, high: values }, { low: oiValues, high: oiValues }, 'full');
    const a: PivotPair = { side: 'low', price: 10, oi: 11, confirmIndex: 13 };
    expect(can(a, 17)).toBe(true); // the OI pivot's sixth bar (17) is B's confirmation: closed
    expect(can(a, 16)).toBe(false); // bar 17 not closed when B confirms
    // the OI pivot alone not full: a lower OI 4 bars after it
    const oiContradicted = oiValues.map((x, i) => (i === 15 ? 950 : x));
    const can2 = aEligibility({ nLeft: 6, nRight: 2 }, { low: values, high: values }, { low: oiContradicted, high: oiContradicted }, 'full');
    expect(can2(a, 25)).toBe(false);
    expect(aEligibility({ nLeft: 6, nRight: 2 }, { low: values, high: values }, { low: oiContradicted, high: oiContradicted }, 'fast')(a, 25)).toBe(true);
  });

  it('diagnose uses the same eligibility: the false bottom is not offered as a near-miss A either', () => {
    // the OI side 3 bars inside δoi (983 vs 980 would pass; 962 vs 960 fails only δoi): a near-miss scene
    const near = scene(O + 80, { [X]: { low: 95, oi: 960 }, [X + 4]: { low: 93 }, [X + 7]: { oi: 962 } });
    for (const mirror of [false, true]) {
      const fastIn = input(near, mirror, { aRule: 'fast' });
      expect(diagnose(fastIn, detectDivergences(fastIn)).map((m) => [m.aIndex, m.bIndex, m.rule])).toEqual([[X, X + 4, 'oi_delta']]);
      const fullIn = input(near, mirror);
      expect(diagnose(fullIn, detectDivergences(fullIn))).toEqual([]);
    }
  });
});

/**
 * IB-141 option 1 (TL review 2026-11-05) — B's OI pivot must hold on the bars up to B. With 6/2 and k = 3 an OI pivot
 * up to 3 bars BEFORE B is confirmed by 2 bars only, so B's own bar can be beyond it. A scene: B's OI pivot at B − 3
 * (980); bar B's OI 975 (below it: the pivot does not stand on B) or 985 (it does). OI after B keeps falling to a low
 * at B + 4, beyond k, so B pairs with B − 3 and nothing else.
 */
describe('option 1: B’s OI pivot holds through B', () => {
  const oiBeforeB = (atB: number, bOi = 980) => scene(O + 80, {
    [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B - 3]: { oi: bOi }, [B]: { low: 93, oi: atB },
    [B + 1]: { oi: atB - 5 }, [B + 2]: { oi: atB - 6 }, [B + 3]: { oi: atB - 7 }, [B + 4]: { oi: atB - 8 },
  });

  it('B’s bar beyond its OI pivot: no divergence; the same pair with B’s bar tying or not beyond: found', () => {
    both(oiBeforeB(975), (r) => {
      expect(r.pairs.find((p) => p.price === B)?.oi).toBe(B - 3); // the pairing happened: the rule refused it
      expect(lines(r)).toEqual([]);
    });
    both(oiBeforeB(985), (r) => expect(lines(r)).toEqual([[A, B]]));
    both(oiBeforeB(980), (r) => expect(lines(r)).toEqual([[A, B]])); // a tie stands (V5's non-strict right side)
  });

  it('diagnose applies it too: a B whose OI pivot does not stand on B is no near-miss either', () => {
    const nm = (atB: number) => {
      const inp = input(oiBeforeB(atB, 962), false); // 962 against A's 960: fails δoi only — a near-miss scene
      return diagnose(inp, detectDivergences(inp)).filter((m) => m.bIndex === B).map((m) => m.rule);
    };
    expect(nm(965)).toEqual(['oi_delta']);
    expect(nm(958)).toEqual([]);
  });

  it('bOiHolds: through B inclusive, ties stand, an unknown bar does not', () => {
    const s = [10, 8, 9, 8, 12];
    expect(bOiHolds(s, { side: 'low', oi: 1, price: 4 })).toBe(true);
    expect(bOiHolds([10, 8, 9, 7.9, 12], { side: 'low', oi: 1, price: 3 })).toBe(false);
    expect(bOiHolds([10, 8, 9, 7.9, 12], { side: 'low', oi: 1, price: 2 })).toBe(true); // bar 3 is after B
    expect(bOiHolds([10, 8, null, 9], { side: 'low', oi: 1, price: 3 })).toBe(false);
    expect(bOiHolds([1, 8, null, 8], { side: 'high', oi: 1, price: 3 })).toBe(false); // null is no tie on either side
    expect(bOiHolds([1, 8, 7, 8.1], { side: 'high', oi: 1, price: 3 })).toBe(false);
    expect(bOiHolds([1, 8, 2, 8], { side: 'high', oi: 1, price: 3 })).toBe(true);
  });

  it('a no-op with nRight ≥ k (6/6): every pair on a random walk holds; at 6/2 some do not', () => {
    let seed = 5;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const bars: Bar[] = [];
    const oi5m: OiPoint[] = [];
    let px = 100;
    let oi = 1_000;
    for (let i = 0; i < 3_000; i++) {
      px += rnd() - 0.5;
      oi += (rnd() - 0.5) * 20;
      bars.push({ time: T0 + i * TF, open: px + 1, high: px + 2, low: px, close: px + 1 });
      for (let k = 1; k <= 3; k++) oi5m.push({ time: T0 + i * TF + k * 300, oi: oi + (rnd() - 0.5) * 4 });
    }
    const series = oiPerBar(bars.map((b) => b.time), oi5m, TF);
    const failing = (nRight: number) => {
      const r = detectDivergences({ tfSec: TF, bars, oi5m, params: { ...P62, nLeft: 6, nRight } });
      return [r.pairs.length, r.pairs.filter((p) => !bOiHolds(p.side === 'low' ? series.min : series.max, p)).length];
    };
    const [n66, f66] = failing(6);
    const [n62, f62] = failing(2);
    expect(n66).toBeGreaterThan(50);
    expect(f66).toBe(0);
    expect(n62).toBeGreaterThan(50);
    expect(f62).toBeGreaterThan(0);
  });
});
