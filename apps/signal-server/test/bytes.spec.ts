import { expectSameBytes } from './bytes';

describe('expectSameBytes (BUG-011)', () => {
  it('passes for identical bytes, fast on a screenshot-sized buffer', () => {
    const big = Buffer.alloc(1024 * 1024, 7);
    const t0 = performance.now();
    expectSameBytes(Buffer.from(big), big);
    expect(performance.now() - t0).toBeLessThan(250); // jest's toEqual takes seconds on this; memcmp takes ~0 ms
  });

  it('fails with the lengths, the first differing byte and the digests', () => {
    const a = Buffer.from([1, 2, 3, 4]);
    expect(() => expectSameBytes(Buffer.from([1, 2, 9, 4]), a)).toThrow(/firstDiff.*2/s);
    expect(() => expectSameBytes(Buffer.from([1, 2]), a)).toThrow(/"length": 2/);
    expect(() => expectSameBytes(undefined, a)).toThrow(/undefined/);
  });
});
