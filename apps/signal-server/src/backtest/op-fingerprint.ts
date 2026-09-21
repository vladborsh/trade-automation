import { createHash } from 'crypto';

/** The mutating backtest operations that carry an `opId` (D9). */
export type OpKind = 'place' | 'cancel' | 'close' | 'advance' | 'modify';

/**
 * JSON with object keys sorted, recursively; arrays keep their order, numbers print as
 * `JSON.stringify` prints them, and `undefined` members are dropped (as `JSON.stringify` does).
 * Two requests that differ only in key order produce the same string.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * BUG-004 — the identity of one mutating request, stored with its op row: `sha256(kind + canonical
 * JSON of the request without `opId` + the target order id)`, hex. The same retry produces the same
 * fingerprint; a different operation or body under the same `opId` does not.
 */
export function opFingerprint(kind: OpKind, request: object, orderId?: string): string {
  const { opId: _opId, ...rest } = request as Record<string, unknown>;
  return createHash('sha256')
    .update(`${kind}\n${canonicalJson(rest)}\n${orderId ?? ''}`)
    .digest('hex');
}
