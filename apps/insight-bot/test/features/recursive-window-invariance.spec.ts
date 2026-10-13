import { featureParamNumber } from '@trade-automation/contracts';
import { emaFeatures } from '../../src/features/calculators/ema';
import { volatilityFeatures } from '../../src/features/calculators/volatility';
import type { AtrBar } from '../../src/features/math/wilder-atr';

/**
 * IB-052 — the positive control for every recursive indicator.
 *
 * > Feed the calculator MORE history than its window and assert the value is IDENTICAL.
 * > A recursive indicator that is not invariant to extra history is reading coverage.
 *
 * This is the test that would have caught the defect. Wilder smoothing and the EMA carry every
 * earlier bar with a decaying weight, so handing them "whatever was complete" made the published
 * value a function of our own coverage: it moved when a derive run healed buckets (84 recorded
 * conflicts, mean 13.30, max 52.55) and two slots with different coverage disagreed about the
 * same close, with neither identifiable as the wrong one.
 *
 * Note what the fixture does NOT do: it never feeds the same number of bars twice. Extra history
 * is prepended, so a calculator that ignored its declared window would return a different number
 * every time.
 */

/** Deterministic, non-flat bars — a flat series is invariant for the wrong reason. */
const bars = (n: number, seed = 1): AtrBar[] =>
  Array.from({ length: n }, (_, i) => {
    const x = Math.sin((i + seed) / 3) * 50 + Math.cos((i + seed) / 7) * 20;
    const close = 80_000 + x + i * 2;
    return { high: close + 40 + Math.abs(x) / 2, low: close - 40 - Math.abs(x) / 2, close };
  });

const closes = (n: number, seed = 1): number[] => bars(n, seed).map((b) => b.close);

const atrOf = (tf: '1h' | '4h' | '1d', supplied: AtrBar[]) =>
  volatilityFeatures({ bars: { [tf]: supplied } })[`atr.${tf}.14` as 'atr.1h.14'];

describe('ATR is invariant to extra history', () => {
  const period = featureParamNumber('atr.1h.14', 'period');
  const warmup = featureParamNumber('atr.1h.14', 'warmupBars');
  const window = period + 1 + warmup;

  it('gives the SAME value for its window and for twice its window', () => {
    // The whole defect in one assertion. Before IB-052 these differed by ~16 on a ~470 value.
    const exact = atrOf('1h', bars(window));
    const doubled = atrOf('1h', bars(window * 2).slice(-window * 2));
    expect(exact).toBeDefined();
    // the LAST `window` bars are identical in both, because extra history is prepended
    const sameTail = bars(window * 2).slice(-window);
    expect(atrOf('1h', sameTail)).toEqual(atrOf('1h', [...bars(99, 7), ...sameTail]));
    expect(doubled).toBeDefined();
  });

  it('is identical across many different amounts of extra history', () => {
    const tail = bars(window, 3);
    const values = [0, 1, 5, 20, 100, 500].map((extra) =>
      atrOf('1h', [...bars(extra, 11), ...tail]));
    const first = JSON.stringify(values[0]);
    for (const v of values) expect(JSON.stringify(v)).toBe(first);
    expect(values[0]).toMatchObject({ ok: true });
  });

  it('REFUSES below its declared window rather than computing from what it has', () => {
    // "Compute it from whatever is available" is the defect, not the fallback.
    expect(atrOf('1h', bars(window - 1))).toEqual({ ok: false, why: 'insufficient_history' });
    expect(atrOf('1h', bars(window))).toMatchObject({ ok: true });
  });

  it('still reports no_data for an empty series, which is a different thing', () => {
    expect(atrOf('1h', [])).toEqual({ ok: false, why: 'no_data' });
  });

  it('holds for all three ATR timeframes', () => {
    for (const tf of ['1h', '4h', '1d'] as const) {
      const w = featureParamNumber(`atr.${tf}.14`, 'period') + 1
        + featureParamNumber(`atr.${tf}.14`, 'warmupBars');
      const tail = bars(w, 5);
      expect(atrOf(tf, tail)).toEqual(atrOf(tf, [...bars(60, 13), ...tail]));
    }
  });

  it('would have FAILED before the fix — the extra history really does change the maths', () => {
    // Guards the guard: if the fixture were flat or the window tiny, invariance would hold
    // trivially and the test above would prove nothing. Feeding wilderAtr directly (no slicing)
    // must disagree across lengths, or this whole spec is vacuous.
    const { wilderAtr } = require('../../src/features/math/wilder-atr') as
      typeof import('../../src/features/math/wilder-atr');
    const tail = bars(window, 3);
    const short = wilderAtr(tail, period);
    const long = wilderAtr([...bars(200, 11), ...tail], period);
    expect(short).not.toBeCloseTo(long as number, 6);
  });
});

describe('EMA is invariant to extra history', () => {
  const length = featureParamNumber('ema.4h.50', 'length');
  const warmup = featureParamNumber('ema.4h.50', 'warmupBars');
  const window = length + warmup;

  const ema4h = (supplied: number[]) => emaFeatures({ closes4h: supplied, closes1d: [] })['ema.4h.50'];

  it('gives the SAME value however much history precedes its window', () => {
    const tail = closes(window, 2);
    const values = [0, 1, 37, 300].map((extra) => ema4h([...closes(extra, 23), ...tail]));
    const first = JSON.stringify(values[0]);
    for (const v of values) expect(JSON.stringify(v)).toBe(first);
    expect(values[0]).toMatchObject({ ok: true });
  });

  it('REFUSES below length + warm-up', () => {
    expect(ema4h(closes(window - 1))).toEqual({ ok: false, why: 'insufficient_history' });
    expect(ema4h(closes(window))).toMatchObject({ ok: true });
  });

  it('would have FAILED before the fix', () => {
    const { emaLast } = require('../../src/features/math/ema') as
      typeof import('../../src/features/math/ema');
    const tail = closes(window, 2);
    expect(emaLast(tail, length)).not.toBeCloseTo(
      emaLast([...closes(300, 23), ...tail], length) as number, 6);
  });
});
