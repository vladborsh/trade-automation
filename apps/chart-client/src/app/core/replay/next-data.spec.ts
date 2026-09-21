import { coversReveal, nextDataAcross, type TapeView } from './next-data';

const M = 60_000;

/** A cache view holding 1m at `mins`, knowing [fromMin, untilMin) (untilMin null = end of tape). */
function view(mins: number[], fromMin: number, untilMin: number | null): TapeView {
  return {
    knownFrom: fromMin * M,
    knownUntil: untilMin === null ? Number.POSITIVE_INFINITY : untilMin * M,
    firstAtOrAfter: (ms: number) => mins.map((m) => m * M).find((t) => t >= ms) ?? null,
  };
}

describe('nextDataAcross (§5.2 nextDataAt over every panel)', () => {
  it('is the earliest candle at or after fromMs on any panel', () => {
    const btc = view([10, 11], 0, 100);
    const eth = view([5, 6], 0, 100);
    expect(nextDataAcross([btc, eth], 0)).toEqual({ kind: 'at', ms: 5 * M });
    expect(nextDataAcross([btc, eth], 7 * M)).toEqual({ kind: 'at', ms: 10 * M });
  });

  it('jumps an empty stretch on every panel', () => {
    expect(nextDataAcross([view([1, 500], 0, 1000), view([2, 600], 0, 1000)], 3 * M)).toEqual({ kind: 'at', ms: 500 * M });
  });

  it('is unknown while a panel with nothing held has not loaded past the candidate', () => {
    const btc = view([50], 0, 100);
    const eth = view([], 0, 20); // knows nothing from minute 20
    expect(nextDataAcross([btc, eth], 0)).toEqual({ kind: 'unknown' });
    expect(nextDataAcross([btc, view([], 0, 51)], 0)).toEqual({ kind: 'at', ms: 50 * M });
  });

  it('is none only when every tape has ended; unknown when a cache is just not filled', () => {
    expect(nextDataAcross([view([], 0, null), view([], 0, null)], 0)).toEqual({ kind: 'none' });
    expect(nextDataAcross([view([], 0, null), view([], 0, 30)], 0)).toEqual({ kind: 'unknown' });
  });

  it('a panel whose tape ended does not block the others', () => {
    expect(nextDataAcross([view([], 0, null), view([40], 0, 100)], 0)).toEqual({ kind: 'at', ms: 40 * M });
  });

  it('is unknown for a time before what a cache knows', () => {
    expect(nextDataAcross([view([10], 5, 100)], 0)).toEqual({ kind: 'unknown' });
  });
});

describe('coversReveal', () => {
  it('needs every cache to know the last 1m revealed at the cursor', () => {
    const c = view([], 0, 10); // knows [0, 10 min)
    expect(coversReveal([c], 10 * M)).toBe(true); // last revealed opens at 9 min
    expect(coversReveal([c], 11 * M)).toBe(false); // would need the 10-min candle
    expect(coversReveal([view([], 0, null)], 1e15)).toBe(true);
  });
});
