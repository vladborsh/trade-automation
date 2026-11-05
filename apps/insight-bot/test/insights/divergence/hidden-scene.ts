import type { Bar, DivergenceInput, DivergenceParams } from '../../../src/insights/divergence/detector';
import type { OiPoint } from '../../../src/insights/divergence/oi-per-bar';

/**
 * IB-144 — hand-built scenes for the HIDDEN pair, in the style of `detector.spec.ts`: a flat baseline (wick low 100,
 * high = low + 2, open = close = low + 1, so closes never decide a pivot) and an alternating OI (1000 / 1010: |ΔOI|
 * median 10 → δoi = 5 at 0.5 ×, and equal neighbours make no OI pivot). ATR14 on the baseline is 2 → δp = 0.5.
 * `mirror` turns lows into highs (price → 200 − price, OI → 2020 − OI): the bearish case of the same scene.
 */
export const TF = 900;
export const T0 = 1_793_000_000 - (1_793_000_000 % TF);
export const P: DivergenceParams = { nLeft: 6, nRight: 6, k: 3, w: 96, atrMult: 0.25, oiMedianMult: 0.5, priceLineTolAtrMult: 0, oiLineTolMedianMult: 0 };

export interface Scene {
  lows: number[];
  oi: number[];
}

export function scene(len: number, set: Record<number, { low?: number; oi?: number }> = {}, baseOi: [number, number] = [1000, 1010], baseLow = 100): Scene {
  return {
    lows: Array.from({ length: len }, (_, i) => set[i]?.low ?? baseLow),
    oi: Array.from({ length: len }, (_, i) => set[i]?.oi ?? baseOi[i % 2]),
  };
}

export function input(s: Scene, mirror = false, params: DivergenceParams = P, oiMirror = 2020): DivergenceInput {
  const bars: Bar[] = s.lows.map((low, i) => {
    const lo = mirror ? 200 - (low + 2) : low;
    return { time: T0 + i * TF, open: lo + 1, high: lo + 2, low: lo, close: lo + 1 };
  });
  const oi5m: OiPoint[] = s.oi.flatMap((v, i) => [1, 2, 3].map((k) => ({ time: T0 + i * TF + k * 300, oi: mirror ? oiMirror - v : v })));
  return { tfSec: TF, bars, oi5m, params };
}

/**
 * The base hidden bullish divergence: A at `a` (wick low 93, OI pivot 960 one bar later), B at `b` (low 95, OI 940):
 * a HIGHER low by 2 (> δp 0.5) with OI LOWER by 20 (> δoi 5); both lines clean (the baseline is above both).
 */
export function hiddenBase(a: number, b: number, len: number): Scene {
  return scene(len, { [a]: { low: 93 }, [a + 1]: { oi: 960 }, [b]: { low: 95, oi: 940 } });
}
