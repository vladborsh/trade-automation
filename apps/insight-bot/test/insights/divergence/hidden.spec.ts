import { detectDivergences, type DivergenceParams } from '../../../src/insights/divergence/detector';
import { diagnose } from '../../../src/insights/divergence/diagnose';
import { detectorParams } from '../../../src/insights/divergence/params';
import { OI_DIVERGENCE_DEFAULT_PARAMS } from '@trade-automation/contracts';
import { hiddenBase, input, P, scene, T0, TF, type Scene } from './hidden-scene';

/**
 * IB-144 (architecture/oi-divergence-design-2026-11-04.md §11, V40–V41) — the hidden pair. Every scene runs as written
 * (bullish, on lows) and mirrored (bearish, on highs). Each is built so it can fail: a refusal has a control that fires
 * once the one thing under test is moved.
 */
const O = 60; // the 100 per-bar OI moves before B must exist (V7): the action sits after them
const A = O + 40;
const B = O + 60;
const LEN = O + 80;

function both(s: Scene, check: (r: ReturnType<typeof detectDivergences>, dir: 'bullish' | 'bearish') => void, params: DivergenceParams = P, oiMirror = 2020) {
  for (const mirror of [false, true]) check(detectDivergences(input(s, mirror, params, oiMirror)), mirror ? 'bearish' : 'bullish');
}

describe('IB-144 V40: the hidden pair — only (1) and (2) flip', () => {
  it('a HIGHER low on a LOWER OI low is one hidden bullish divergence A→B (mirror: a LOWER high on HIGHER OI, hidden bearish); nothing regular', () => {
    both(hiddenBase(A, B, LEN), (r, dir) => {
      expect(r.divergences.map((d) => [d.kind, d.direction, d.aIndex, d.bIndex, d.runLength])).toEqual([['hidden', dir, A, B, 2]]);
      const d = r.divergences[0];
      // V43's sign rule, on the detector's own output: bullish price up / OI down, bearish the reverse
      if (dir === 'bullish') expect([d.pricePct > 0, d.oiPct < 0]).toEqual([true, true]);
      else expect([d.pricePct < 0, d.oiPct > 0]).toEqual([true, true]);
    });
  });

  it('the regular base case stays regular and alone (a lower low on a higher OI low): kind is carried, the hidden branch adds nothing', () => {
    const regular = scene(LEN, { [A]: { low: 95 }, [A + 1]: { oi: 960 }, [B]: { low: 93, oi: 980 } });
    both(regular, (r, dir) => expect(r.divergences.map((d) => [d.kind, d.direction, d.aIndex, d.bIndex])).toEqual([['regular', dir, A, B]]));
  });

  it('(1) flipped: a higher low by NO MORE than δp is refused; by a little more it fires (control)', () => {
    // ATR14 on the baseline is 2 → δp = 0.5: 93 → 93.5 is exactly δp (refused, strict), 93 → 93.6 passes
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [B]: { low: 93.5, oi: 940 } }), (r) => expect(r.divergences).toEqual([]));
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [B]: { low: 93.6, oi: 940 } }), (r) => expect(r.divergences.map((d) => d.kind)).toEqual(['hidden']));
  });

  it('(2) flipped: OI lower by NO MORE than δoi (5) is refused; 6 lower fires (control)', () => {
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [B]: { low: 95, oi: 955 } }), (r) => expect(r.divergences).toEqual([]));
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [B]: { low: 95, oi: 954 } }), (r) => expect(r.divergences.map((d) => d.kind)).toEqual(['hidden']));
  });

  it('the line side follows the PIVOT, not the kind: a wick BELOW the rising hidden support line kills it; the same wick above the line does not', () => {
    // the line 93 → 95 over 20 bars is 94 at A + 10. Below it by 0.5 (tolerance 0, round 1): refused. Above by 0.5: fires.
    // A mutation that checked the hidden line on the other side (above a low line) flips both outcomes.
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [A + 10]: { low: 93.5 }, [B]: { low: 95, oi: 940 } }), (r) => expect(r.divergences).toEqual([]));
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [A + 10]: { low: 94.5 }, [B]: { low: 95, oi: 940 } }), (r) => expect(r.divergences.map((d) => d.kind)).toEqual(['hidden']));
  });

  it('…and on the OI line: a per-bar OI BELOW the falling hidden OI line kills it; above it does not', () => {
    // OI line 960 (A + 1) → 940 (B) is 950.5 at A + 10 (≈): 945 is below it, 1000 (the baseline) is above it
    both(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [A + 10]: { oi: 945 }, [B]: { low: 95, oi: 940 } }), (r) => expect(r.divergences).toEqual([]));
    both(hiddenBase(A, B, LEN), (r) => expect(r.divergences).toHaveLength(1));
  });

  it('pairing, W and the full A are the same code: B beyond W of A is refused (W = 19 bars), within it fires', () => {
    both(hiddenBase(A, B, LEN), (r) => expect(r.divergences).toEqual([]), { ...P, w: 19 });
    both(hiddenBase(A, B, LEN), (r) => expect(r.divergences).toHaveLength(1), { ...P, w: 20 });
  });
});

describe('IB-144 V41: one B, both kinds, and runs per (kind, direction)', () => {
  // A2 (low 90, OI 1100) … A1 (low 100, OI 1000) … B (low 95, OI 1050), on a baseline of low 110 / OI 1200–1240
  // (|ΔOI| median 40 → δoi 20; OI line tolerance 2.5 × 40 = 100, so A1's OI under the hidden A2–B line, by ≈ 75, is
  // inside it). Regular A1–B: lower low, higher OI. Hidden A2–B: higher low, lower OI. Hidden A2–A1 also holds (a
  // higher low on lower OI), so A2–B is that hidden run's repeat — and the regular A1–B is NOT counted into it.
  // ten bars later than the other scenes: A1 is a B too (of the hidden A2–A1), and needs its own 100 OI moves
  const A2 = O + 30;
  const A1 = O + 50;
  const B2 = O + 70;
  const s = scene(LEN + 10, { [A2]: { low: 90, oi: 1100 }, [A1]: { low: 100, oi: 1000 }, [B2]: { low: 95, oi: 1050 } }, [1200, 1240], 110);
  const params = { ...P, oiLineTolMedianMult: 2.5 };

  it('B carries a regular line against A1 AND a hidden line against A2: both kept, each its own run', () => {
    both(s, (r, dir) => {
      const at = (i: number) => (T0 + i * TF);
      expect(r.divergences.map((d) => [d.kind, d.direction, d.aIndex, d.bIndex, d.runLength, d.runFirstBTime])).toEqual([
        ['hidden', dir, A2, A1, 2, null],
        ['regular', dir, A1, B2, 2, null], // regular first at the same moment (the stable order)
        ['hidden', dir, A2, B2, 3, at(A1)], // the hidden run's third pivot; the regular line did not extend it
      ]);
    }, params, 2_480);
  });

  it('control: without the OI line tolerance the hidden A2–B line is crossed by A1’s OI and only regular A1–B and hidden A2–A1 remain', () => {
    both(s, (r) => expect(r.divergences.map((d) => [d.kind, d.aIndex, d.bIndex])).toEqual([['hidden', A2, A1], ['regular', A1, B2]]), P, 2_480);
  });
});

describe('IB-144 V41: a regular line never extends a hidden run (same A)', () => {
  // A (low 95, OI 1000) → B1 (low 97, OI 960): hidden. A → B2 (low 93, OI 1050): regular, from the SAME A, B1 between.
  // Were runs shared across kinds, A–B2 would read as the third pivot of A–B1's run. Baseline low 110 / OI 1200–1240;
  // OI line tolerance 2.5 × 40 = 100 covers B1's OI under the A–B2 OI line (≈ 65).
  const A0 = O + 30;
  const B1 = O + 50;
  const B2 = O + 70;
  const s = scene(LEN + 10, { [A0]: { low: 95, oi: 1000 }, [B1]: { low: 97, oi: 960 }, [B2]: { low: 93, oi: 1050 } }, [1200, 1240], 110);
  it('hidden A–B1 is a first line, regular A–B2 is a first line too (run 2, no run start)', () => {
    both(s, (r, dir) => {
      expect(r.divergences.map((d) => [d.kind, d.direction, d.aIndex, d.bIndex, d.runLength, d.runFirstBTime])).toEqual([
        ['hidden', dir, A0, B1, 2, null],
        ['regular', dir, A0, B2, 2, null],
      ]);
    }, { ...P, oiLineTolMedianMult: 2.5 }, 2_480);
  });
});

describe('IB-144 V41: near-misses per kind', () => {
  it('a hidden candidate short of δoi is a HIDDEN oi_delta near-miss; the same B is no regular near-miss (it fails both regular conditions)', () => {
    for (const mirror of [false, true]) {
      const inp = input(scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [B]: { low: 95, oi: 958 } }), mirror);
      const r = detectDivergences(inp);
      expect(r.divergences).toEqual([]);
      const m = diagnose(inp, r);
      expect(m.map((x) => [x.kind, x.direction, x.aIndex, x.bIndex, x.rule])).toEqual([['hidden', mirror ? 'bearish' : 'bullish', A, B, 'oi_delta']]);
      expect(m[0].miss).toBeCloseTo((5 - 2) / 5, 9); // shortfall ÷ δoi, as the regular rule counts it
    }
  });

  it('a B DETECTED as hidden gets no hidden near-miss, but can still get a regular one (detection is per kind)', () => {
    // the hidden base case, plus A0 between A and B (low 95.4, OI pivot 930): regular A0–B misses only on δp (B is
    // lower by 0.4 ≤ 0.5). A0's OI sits ≈ 19 under the hidden A–B OI line, inside a 2.5 × 10 tolerance.
    const s = scene(LEN, { [A]: { low: 93 }, [A + 1]: { oi: 960 }, [O + 50]: { low: 95.4 }, [O + 51]: { oi: 930 }, [B]: { low: 95, oi: 940 } });
    const inp = input(s, false, { ...P, oiLineTolMedianMult: 2.5 });
    const r = detectDivergences(inp);
    expect(r.divergences.map((d) => [d.kind, d.bIndex])).toContainEqual(['hidden', B]);
    const m = diagnose(inp, r).filter((x) => x.bIndex === B);
    expect(m.map((x) => x.kind)).not.toContain('hidden');
    expect(m.map((x) => [x.kind, x.rule])).toEqual([['regular', 'price_delta']]);
  });
});

describe('IB-144 V42: sendHidden is a delivery switch, not a detector param', () => {
  it('detectorParams hands the detector exactly its own keys — sendHidden stays with the loop', () => {
    const p = { ...OI_DIVERGENCE_DEFAULT_PARAMS, perTf: { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf, '1h': { ...OI_DIVERGENCE_DEFAULT_PARAMS.perTf['1h'], sendHidden: true } } };
    expect(Object.keys(detectorParams(p, '1h')).sort()).toEqual(['atrMult', 'k', 'nLeft', 'nRight', 'oiLineTolMedianMult', 'oiMedianMult', 'priceLineTolAtrMult', 'w']);
  });
});
