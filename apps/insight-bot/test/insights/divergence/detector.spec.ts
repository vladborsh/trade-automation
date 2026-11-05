import { OI_DIVERGENCE_DEFAULT_PARAMS, OI_DIVERGENCE_TF_SEC, OI_DIVERGENCE_TFS } from '@trade-automation/contracts';
import { ATR_PERIOD, barsForEvaluation, detectDivergences, OI_MEDIAN_BARS, type Bar, type DivergenceInput, type DivergenceParams } from '../../../src/insights/divergence/detector';
import { detectorParams } from '../../../src/insights/divergence/params';
import type { OiPoint } from '../../../src/insights/divergence/oi-per-bar';

/**
 * IB-109 — the detector's eleven specs (architecture/oi-divergence-design-2026-11-04.md §3), on
 * hand-built bars. Each is built so it CAN fail: the bars make the rule under test the only thing
 * deciding the outcome, and where a rule refuses, a control shows the same bars firing once that
 * rule is relaxed (so the refusal is the rule's, not an accident of the fixture).
 *
 * Spec 11, the mirror: every scenario runs as written (bullish, on lows) AND mirrored (bearish, on
 * highs: price → 200 − price, OI → 2020 − OI), through `both()`.
 */
const TF = 900; // 15m
const T0 = 1_793_000_000 - (1_793_000_000 % TF);
/** Line tolerances 0: the §3 specs below are round 1's rule, unchanged (V18: «0 restores the round-1 rule exactly»). */
const P: DivergenceParams = { nLeft: 6, nRight: 6, k: 3, w: 96, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 };
const BASE_LOW = 100;
const BASE_OI = [1000, 1010]; // alternating: |ΔOI| median 10 → δoi = 5, and equal neighbours make no OI pivot

interface Scene {
  /** Wick low per bar (high = low + 2, open = close = low + 1, so closes never decide a pivot). */
  lows: number[];
  /** Per bar, its three readings (labels open+5m, +10m, +15m); a number means all three equal. */
  oi: Array<number | [number, number, number]>;
  /** Readings to drop: [bar, slot 0..2]. */
  drop?: Array<[number, number]>;
}

function scene(len: number, set: Record<number, { low?: number; oi?: number | [number, number, number] }> = {}): Scene {
  const lows = Array.from({ length: len }, (_, i) => set[i]?.low ?? BASE_LOW);
  const oi = Array.from({ length: len }, (_, i) => set[i]?.oi ?? BASE_OI[i % 2]);
  return { lows, oi };
}

function input(s: Scene, mirror: boolean, extra: Partial<DivergenceInput> = {}): DivergenceInput {
  const px = (v: number) => (mirror ? 200 - v : v);
  const ox = (v: number) => (mirror ? 2020 - v : v);
  const bars: Bar[] = s.lows.map((low, i) => {
    const lo = mirror ? px(low + 2) : low;
    return { time: T0 + i * TF, open: lo + 1, high: lo + 2, low: lo, close: lo + 1 };
  });
  const drop = new Set((s.drop ?? []).map(([b, k]) => `${b}:${k}`));
  const oi5m: OiPoint[] = s.oi.flatMap((v, i) => {
    const three = typeof v === 'number' ? [v, v, v] : v;
    return three.map((x, k) => ({ time: T0 + i * TF + (k + 1) * 300, oi: ox(x) })).filter((_, k) => !drop.has(`${i}:${k}`));
  });
  return { tfSec: TF, bars, oi5m, params: P, ...extra };
}

/** Runs a scenario as bullish (lows) and as its bearish mirror (highs); the check gets the expected direction. */
function both(s: Scene, check: (r: ReturnType<typeof detectDivergences>, dir: 'bullish' | 'bearish', mirror: boolean) => void, extra?: Partial<DivergenceInput>) {
  for (const mirror of [false, true]) check(detectDivergences(input(s, mirror, extra)), mirror ? 'bearish' : 'bullish', mirror);
}

/** A at 40 (low 95, OI 960 at 41), B at 60 (low 93, OI 980): a clean bullish divergence. */
/**
 * Every scene starts with O baseline bars: B is evaluated only once the 100 per-bar OI moves before it exist
 * (`OI_MEDIAN_BARS + 1` bars, V7), so the action sits after them. Bar numbers in comments are relative to O.
 */
const O = 60;
const A = O + 40;
const B = O + 60;
const base = () => scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 } });

describe('detectDivergences — the base case and the mirror (spec 11)', () => {
  it('a lower low on a higher OI low is one divergence A→B; its mirror is one bearish', () => {
    both(base(), (r, dir) => {
      expect(r.divergences).toHaveLength(1);
      const d = r.divergences[0];
      expect([d.direction, d.aIndex, d.bIndex, d.runLength, d.runFirstBTime]).toEqual([dir, A, B, 2, null]);
      expect(d.a.oiTime).toBe(T0 + (A + 1) * TF + 300); // the OI pivot's own reading, a bar after the price pivot
      expect(d.pricePct).toBeCloseTo(dir === 'bullish' ? -2.105 : (107 / 105 - 1) * 100, 2);
      expect(r.skips).toEqual([]);
    });
  });
});

describe('detectDivergences — the owner’s rules (design §3)', () => {
  it('1. a low is ruled on WICKS: closes say no pivot, the wick says pivot', () => {
    both(base(), (r, _dir, mirror) => {
      expect(mirror ? r.pivots.highs : r.pivots.lows).toEqual([A, B]);
    });
    // Flat closes (every bar opens and closes at the baseline, the wick alone reaches down): a close-based rule
    // finds nothing here, the wick rule still finds A and B — and the divergence.
    for (const mirror of [false, true]) {
      const inp = input(base(), mirror);
      const flat = { ...inp, bars: inp.bars.map((b) => (mirror
        ? { ...b, open: 99, close: 99, low: Math.min(b.low, 98) }
        : { ...b, open: 101, close: 101, high: Math.max(b.high, 102) })) };
      const r = detectDivergences(flat);
      expect(mirror ? r.pivots.highs : r.pivots.lows).toEqual([A, B]);
      expect(r.divergences).toHaveLength(1);
    }
  });

  it('2. equal lows: the first is the pivot, the second is not; a double bottom within W still pairs', () => {
    const s = scene(O + 80, { [A]: { low: 95, oi: 960 }, [A + 1]: { low: 95 }, [B]: { low: 95, oi: 980 } });
    both(s, (r, _d, mirror) => {
      expect(mirror ? r.pivots.highs : r.pivots.lows).toEqual([A, B]); // not A+1
      expect(r.pairs.map((p) => p.price)).toEqual([A, B]); // the double bottom: both bottoms are paired
      expect(r.divergences).toEqual([]); // equal, not lower: no divergence
    });
  });

  it('3. a pivot is not confirmed until bar i+N has closed (equal sides here; unequal: pivot-sides.spec.ts)', () => {
    for (const mirror of [false, true]) {
      const full = input(base(), mirror);
      const cut = (last: number) => detectDivergences({ ...full, bars: full.bars.slice(0, last + 1) });
      const early = cut(B + P.nRight - 1); // bar B+5 is the last closed: B is not a pivot yet — not merely an unconfirmed pair
      expect(mirror ? early.pivots.highs : early.pivots.lows).toEqual([A]);
      expect(early.divergences).toEqual([]);
      expect(mirror ? cut(B + P.nRight).pivots.highs : cut(B + P.nRight).pivots.lows).toEqual([A, B]);
      const r = cut(B + P.nRight);
      expect(r.divergences.map((d) => d.bIndex)).toEqual([B]);
      expect(r.divergences[0].confirmedAt).toBe(T0 + (B + P.nRight + 1) * TF); // the close of bar B+N
    }
  });

  it('4. OI per bar is the MIN for lows and the MAX for highs: a bar whose last reading is high, an inner one low', () => {
    // A's OI bar: readings 1000, 960, 1010 — its min (960) is a pivot, its last reading (1010) is not
    const s = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: [1000, 960, 1010] }, [B]: { low: 93, oi: 980 } });
    both(s, (r, dir) => {
      expect(r.divergences).toHaveLength(1);
      expect(r.divergences[0].a.oi).toBe(dir === 'bullish' ? 960 : 2020 - 960);
      expect(r.divergences[0].a.oiTime).toBe(T0 + (A + 1) * TF + 600); // the inner reading's own time
    });
  });

  it('5. pairing within ±k: an OI pivot at k+1 does not pair; of two, the nearest wins', () => {
    const far = scene(O + 80, { [A]: { low: 95 }, [A + P.k + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 } });
    both(far, (r) => {
      expect(r.pairs.map((p) => p.price)).toEqual([B]); // A has no OI pivot within ±3: it takes no part
      expect(r.divergences).toEqual([]);
    });
    const atK = scene(O + 80, { [A]: { low: 95 }, [A + P.k]: { oi: 960 }, [B]: { low: 93, oi: 980 } });
    both(atK, (r) => expect(r.divergences).toHaveLength(1)); // control: at exactly k it pairs
    // Two OI pivots near A. With N = 6 two pivots within ±3 of one bar cannot both exist (each needs 6 bars of
    // higher neighbours), so this part runs at N = 2: pivots at −2 and +1 → the nearer (+1); at −2 and +2 → the earlier.
    const n2 = { params: { ...P, nLeft: 2, nRight: 2 } };
    const nearer = scene(O + 80, { [A - 2]: { oi: 955 }, [A]: { low: 95 }, [A + 1]: { oi: 958 }, [B]: { low: 93, oi: 980 } });
    both(nearer, (r) => {
      expect(r.pivots.oiLows.length + r.pivots.oiHighs.length).toBeGreaterThanOrEqual(3); // both OI pivots exist (and B's)
      expect(r.pairs.find((p) => p.price === A)?.oi).toBe(A + 1);
    }, n2);
    const tie = scene(O + 80, { [A - 2]: { oi: 955 }, [A]: { low: 95 }, [A + 2]: { oi: 958 }, [B]: { low: 93, oi: 980 } });
    both(tie, (r) => expect(r.pairs.find((p) => p.price === A)?.oi).toBe(A - 2), n2);
  });

  it('6. of several valid A, the FARTHEST wins', () => {
    // Both A are valid for B = 70: from 30 the lines run 96 → 93 (94.5 at bar 50: the 95 wick is above it) and
    // 950 → 980 (≈ 965 at bar 51: the 970 OI is above it). 50 also qualifies on its own (93 < 95, 980 > 970).
    const s = scene(O + 90, { [O + 30]: { low: 96 }, [O + 31]: { oi: 950 }, [O + 50]: { low: 95 }, [O + 51]: { oi: 970 }, [O + 70]: { low: 93, oi: 980 } });
    both(s, (r) => {
      const last = r.divergences.filter((d) => d.bIndex === O + 70);
      expect(last).toHaveLength(1);
      expect(last[0].aIndex).toBe(O + 30);
    });
    // control: without the farther one, the nearer A is the one taken — so the choice above was the rule's
    const near = scene(O + 90, { [O + 50]: { low: 95 }, [O + 51]: { oi: 970 }, [O + 70]: { low: 93, oi: 980 } });
    both(near, (r) => expect(r.divergences.filter((d) => d.bIndex === O + 70).map((d) => d.aIndex)).toEqual([O + 50]));
  });

  it('7. line validity (tolerance 0 = round 1): a wick below the A–B price line refuses A; so does a per-bar OI below the OI line', () => {
    // the price line runs 95 → 93 over 20 bars: 94 at bar 50. A wick at 93.6 there crosses it.
    const wick = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [A + 10]: { low: 93.6 }, [B]: { low: 93, oi: 980 } });
    both(wick, (r) => expect(r.divergences).toEqual([]));
    const above = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [A + 10]: { low: 94.2 }, [B]: { low: 93, oi: 980 } });
    both(above, (r) => expect(r.divergences).toHaveLength(1)); // control: the same wick above the line passes
    // the OI line runs 960 (bar 41) → 980 (bar 60): ≈ 969.5 at bar 50. A per-bar min of 965 there crosses it.
    const oiDip = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [A + 10]: { oi: [1000, 965, 1000] }, [B]: { low: 93, oi: 980 } });
    both(oiDip, (r) => expect(r.divergences).toEqual([]));
    const oiOk = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [A + 10]: { oi: [1000, 975, 1000] }, [B]: { low: 93, oi: 980 } });
    both(oiOk, (r) => expect(r.divergences).toHaveLength(1));
    // V18 control: the same crossings are within the round-2 default tolerances (0.4 under the line vs 0.25 × ATR14
    // ≈ 0.74 there; 4.5 under the OI line vs 0.5 × median 10 = 5), so with them A is accepted — what refused it
    // above is the tolerance being 0, nothing else in the fixture
    const round2 = { params: { ...P, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 } };
    both(wick, (r) => expect(r.divergences).toHaveLength(1), round2);
    both(oiDip, (r) => expect(r.divergences).toHaveLength(1), round2);
  });

  it('8. noise: a lower low by 0.1 × ATR does not fire — and does once the threshold is off', () => {
    // ATR14 at B ≈ 2.3 (TR 2 per bar; B's own bar reaches 6.2 below the previous close): δp ≈ 0.58. A low 0.2 under A's
    // (≈ 0.1 × ATR) is inside it.
    const s = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 94.8, oi: 980 } });
    both(s, (r) => expect(r.divergences).toEqual([]));
    both(s, (r) => expect(r.divergences).toHaveLength(1), { params: { ...P, atrMult: 0 } });
    // the OI side: 965 against A's 960 is inside δoi (0.5 × median |ΔOI| 10 = 5) — the comparison is strict
    const oiNoise = scene(O + 80, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 965 } });
    both(oiNoise, (r) => expect(r.divergences).toEqual([]));
    both(oiNoise, (r) => expect(r.divergences).toHaveLength(1), { params: { ...P, oiMedianMult: 0 } });
  });

  it('9. a repeat: A, B, C gives two alerts — the second has run length 3 and runs A–C', () => {
    const s = scene(O + 100, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 }, [B + 20]: { low: 91, oi: 990 } });
    both(s, (r, dir) => {
      expect(r.divergences.map((d) => [d.direction, d.aIndex, d.bIndex, d.runLength])).toEqual([
        [dir, A, B, 2],
        [dir, A, B + 20, 3],
      ]);
      expect(r.divergences[1].runFirstBTime).toBe(T0 + B * TF);
    });
  });

  it('10. a hole in OI inside the window skips the evaluation; a slot the venue did not publish does not', () => {
    const s = { ...base(), drop: [[A - 10, 1]] as Array<[number, number]> }; // A−10's second reading is missing
    const holeSlot = T0 + (A - 10) * TF + 600;
    both(s, (r) => {
      expect(r.divergences).toEqual([]);
      // both evaluations whose window holds the hole are skipped: A's (as a B with no earlier A) and B's
      expect(r.skips).toEqual([A, B].map((i) => ({ barTime: T0 + i * TF, reason: 'no_oi_data', holeFrom: holeSlot, holeTo: holeSlot })));
    });
    both(s, (r) => {
      expect(r.skips).toEqual([]);
      expect(r.divergences.map((d) => d.bIndex)).toEqual([B]);
    }, { venueSilent: [{ from: holeSlot, to: holeSlot }] });
    // a slot not due yet (the venue's publish lag) is not a hole either: B's window ends at bar B+k+N = 69's close
    const late = { ...base(), drop: [[B + 9, 2]] as Array<[number, number]> };
    const lastSlot = T0 + (B + 10) * TF;
    both(late, (r) => expect(r.skips.map((x) => x.holeFrom)).toEqual([lastSlot]), { oiDueUntil: lastSlot }); // control: due → a hole
    both(late, (r) => expect(r.skips).toEqual([]), { oiDueUntil: lastSlot - 300 });
  });
});

/**
 * IB-114 (V18) — line tolerances, at their boundary, for both lines and both sides (`both()` mirrors every scene).
 * The numbers are chosen so the boundary is exact in floating point, so «on the boundary passes» (strict `<`) is
 * decidable:
 * - price: A low 74 at bar 20, B low 70 at bar 60 → the line is exactly 72 at bar 40. ATR14 AT BAR 40 is
 *   (13 × 2 + TR) / 14 where its own TR = 101 − low (a drop from the previous close 101); at a low of 71 that is
 *   (26 + 30) / 14 = 4 → tolerance 0.25 × 4 = 1 → boundary 71. ATR14 at B is (26 + 31) / 14 ≈ 4.07, so a
 *   tolerance taken at B (not at the crossing bar, as ruled) would admit 70.99 — the «just outside» case;
 * - OI: OI pivots 960 at A and 980 at B → the OI line is exactly 970 at bar 40; the median |ΔOI| is 10 → tolerance
 *   0.5 × 10 = 5 → boundary 965.
 */
describe('detectDivergences — V18 line tolerances (round 2)', () => {
  const A2 = O + 20;
  const B2 = O + 60;
  const J = O + 40;
  const R2: Partial<DivergenceInput> = { params: { ...P, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 } };
  const priceScene = (wick: number) => scene(O + 80, { [A2]: { low: 74, oi: 960 }, [J]: { low: wick }, [B2]: { low: 70, oi: 980 } });
  const oiScene = (dip: number) => scene(O + 80, { [A2]: { low: 74, oi: 960 }, [J]: { oi: [1000, dip, 1000] }, [B2]: { low: 70, oi: 980 } });
  const found = (r: ReturnType<typeof detectDivergences>) => r.divergences.map((d) => [d.aIndex, d.bIndex]);

  it('price: a wick inside the tolerance passes, ON it passes, just beyond it does not; tolerance 0 is round 1', () => {
    both(priceScene(71.5), (r) => expect(found(r)).toEqual([[A2, B2]]), R2); // 0.5 under the line
    both(priceScene(71), (r) => expect(found(r)).toEqual([[A2, B2]]), R2); // exactly 1 = 0.25 × ATR14(bar 40) under it
    both(priceScene(70.99), (r) => expect(found(r)).toEqual([]), R2); // 1.01 under it; ATR there 4.0007 → tolerance 1.0002
    both(priceScene(71.5), (r) => expect(found(r)).toEqual([]), { params: { ...P, oiLineTolMedianMult: 0.5 } }); // price tolerance 0
    both(priceScene(72), (r) => expect(found(r)).toEqual([[A2, B2]]), { params: P }); // control: ON the line is not a crossing
  });

  it('OI: a per-bar OI inside the tolerance passes, ON it passes, just beyond it does not; tolerance 0 is round 1', () => {
    both(oiScene(967), (r) => expect(found(r)).toEqual([[A2, B2]]), R2);
    both(oiScene(965), (r) => expect(found(r)).toEqual([[A2, B2]]), R2); // exactly 5 = 0.5 × median 10 under the line
    both(oiScene(964.99), (r) => expect(found(r)).toEqual([]), R2);
    both(oiScene(967), (r) => expect(found(r)).toEqual([]), { params: { ...P, priceLineTolAtrMult: 0.25 } }); // OI tolerance 0
    both(oiScene(970), (r) => expect(found(r)).toEqual([[A2, B2]]), { params: P });
  });

  it('each tolerance is its own line’s: a generous OI tolerance does not let a wick through, nor the reverse', () => {
    both(priceScene(70.99), (r) => expect(found(r)).toEqual([]), { params: { ...P, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 5 } });
    both(oiScene(964.99), (r) => expect(found(r)).toEqual([]), { params: { ...P, priceLineTolAtrMult: 5, oiLineTolMedianMult: 0.5 } });
  });
});

/**
 * TL 2026-11-04 (V10): the bars a caller must fetch, from the constants. On each TF's defaults, the scene puts
 * the newest B the window can confirm (its OI pivot k bars AFTER it, then N to confirm) and its A exactly W bars
 * back. With `barsForEvaluation(params)` bars B is judged and found; with ONE bar fewer it is not — so the
 * number is the minimum, not a guess on either side.
 */
describe('barsForEvaluation — the minimum closed bars for a full evaluation of the newest B', () => {
  it('derives 113 / 185 / 107 for 15m / 1h / 4h from OI_MEDIAN_BARS, ATR_PERIOD and W, nLeft, nRight, k — weight 2 each', () => {
    const counts = OI_DIVERGENCE_TFS.map((tf) => barsForEvaluation(OI_DIVERGENCE_DEFAULT_PARAMS.perTf[tf]));
    // IB-114: 1h W 168 (V19), and ATR14 at a line's crossing bar (V18); IB-141: 4h 6/2 confirms 4 bars sooner (was 111)
    expect(counts).toEqual([113, 185, 107]);
    expect(counts.every((c) => c >= 100 && c < 500)).toBe(true); // Binance klines: limit 100–499 is weight 2
    expect(OI_MEDIAN_BARS + 1).toBeGreaterThan(ATR_PERIOD); // at B, the median, not ATR, is the binding constraint
  });

  it.each(OI_DIVERGENCE_TFS)('%s: exactly that many bars finds B; one fewer does not', (tf) => {
    const p = detectorParams(OI_DIVERGENCE_DEFAULT_PARAMS, tf);
    expect(minimalBasisFound(p, OI_DIVERGENCE_TF_SEC[tf])).toEqual([1, 0]);
  });

  // IB-141 (V35): sides that differ, chosen so each term binds and a term on the wrong side miscounts
  it.each([
    // A's nLeft binds (W + 9): counting nRight before B would give W + max(2, 4) — too few
    ['nLeft 9 / nRight 2', { nLeft: 9, nRight: 2, k: 3, w: 120 }, 120 + 9 + 3 + 2 + 1],
    // the crossing bar's ATR binds: A's right reach is max(2, 4) = 4 → W + 14 − 4 − 1; with nLeft there, two too many
    ['nLeft 2 / nRight 4', { nLeft: 2, nRight: 4, k: 3, w: 120 }, 120 + 9 + 3 + 4 + 1],
  ])('unequal sides, %s: the count is exact — that many finds B, one fewer does not', (_name, tfp, count) => {
    const p: DivergenceParams = { ...P, ...tfp, priceLineTolAtrMult: 0.25, oiLineTolMedianMult: 0.5 };
    expect(barsForEvaluation(p)).toBe(count);
    expect(minimalBasisFound(p, 900)).toEqual([1, 0]);
  });
});

/**
 * The newest B a window can confirm (its OI pivot k bars AFTER it, then nRight to confirm = the last bar) with its
 * A exactly W bars back, on exactly `barsForEvaluation(p)` bars; returns how many A–B lines are found with all of
 * them and with the oldest bar dropped.
 */
function minimalBasisFound(p: DivergenceParams, tfSec: number): [number, number] {
  {
    const len = barsForEvaluation(p);
    const b = len - 1 - p.k - p.nRight;
    const a = b - p.w;
    // V18: the first bar that CAN cross the line (A + max(nLeft, nRight) + 1, V36's right reach) dips 0.3 under it —
    // inside 0.25 × its ATR14 (≈ 0.72), so it passes only while that bar's ATR history is in the window
    const j = a + Math.max(p.nLeft, p.nRight) + 1;
    const lineJ = 95 + ((93 - 95) * (j - a)) / (b - a);
    const t0 = 1_793_000_000 - (1_793_000_000 % 14_400);
    const lowAt = (i: number) => (i === a ? 95 : i === b ? 93 : i === j ? lineJ - 0.3 : 100);
    const oiAt = (i: number) => (i === a ? 960 : i === b + p.k ? 980 : 1000 + 10 * (i % 2));
    const bars = Array.from({ length: len }, (_, i) => ({ time: t0 + i * tfSec, open: lowAt(i) + 1, high: lowAt(i) + 2, low: lowAt(i), close: lowAt(i) + 1 }));
    const per = tfSec / 300;
    const oi5m = Array.from({ length: len }, (_, i) => Array.from({ length: per }, (_, j) => ({ time: t0 + i * tfSec + (j + 1) * 300, oi: oiAt(i) }))).flat();
    const found = (from: number) => detectDivergences({ tfSec, bars: bars.slice(from), oi5m, params: p })
      .divergences.filter((d) => d.b.time === bars[b].time && d.a.time === bars[a].time);
    // the oldest bar gone: the crossing bar loses its ATR14 (15m, 1h), B a noise bar (4h), or A its left side
    return [found(0).length, found(1).length];
  }
}
