import { createHash } from 'crypto';

/**
 * BUG-011 — asserts two byte buffers are identical without jest's deep equality. `toEqual` walks a
 * Buffer element by element: on a 230 KB screenshot that is ~1.5 s of synchronous CPU, and on a
 * 920 KB one ~7 s, on an idle machine. Under load that blew jest's 5 s timeout. The stall also
 * outlived the in-process server's 5 s keep-alive timeout, so the next request reused a socket the
 * server was closing and failed with ECONNRESET. `Buffer.equals` is a memcmp; a mismatch still
 * reports the lengths, the first differing byte and both digests.
 */
export function expectSameBytes(actual: Buffer | undefined | null, expected: Buffer): void {
  if (actual && Buffer.isBuffer(actual) && actual.equals(expected)) return;
  const describe = (b: Buffer | undefined | null) =>
    b && Buffer.isBuffer(b) ? { length: b.length, sha256: createHash('sha256').update(b).digest('hex') } : { value: String(b) };
  let firstDiff: number | undefined;
  if (actual && Buffer.isBuffer(actual)) {
    const n = Math.min(actual.length, expected.length);
    for (let i = 0; i < n; i++) {
      if (actual[i] !== expected[i]) {
        firstDiff = i;
        break;
      }
    }
    if (firstDiff === undefined) firstDiff = n; // one is a prefix of the other
  }
  expect({ actual: describe(actual), firstDiff }).toEqual({ actual: describe(expected), firstDiff: undefined });
}
