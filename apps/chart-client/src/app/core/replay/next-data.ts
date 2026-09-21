import type { AheadCache } from './ahead-cache';

const ONE_MINUTE_MS = 60_000;

/** What one panel's cache can say: its earliest held 1m at or after a time, and how far it knows. */
export type TapeView = Pick<AheadCache, 'firstAtOrAfter' | 'knownFrom' | 'knownUntil'>;

export type NextData =
  | { kind: 'at'; ms: number } // earliest 1m openTime >= fromMs on any panel
  | { kind: 'none' } // every panel's tape has ended before any such candle
  | { kind: 'unknown' }; // some cache has not loaded far enough to tell — fetch, then ask again

/**
 * backtest-app-system-design.md §5.2's `nextDataAt(fromMs)` over all panels' ahead caches: the
 * earliest 1m `openTime >= fromMs` on any panel. A panel whose cache holds nothing from `fromMs`
 * is only known to be empty up to its `knownUntil`, so the answer is `unknown` unless every such
 * panel is known empty at least up to the candidate (or to the end of its tape). Never answers
 * `none` for a cache that merely has not been filled — that would end the session early.
 */
export function nextDataAcross(caches: readonly TapeView[], fromMs: number): NextData {
  let best: number | null = null;
  for (const c of caches) {
    if (fromMs < c.knownFrom) return { kind: 'unknown' };
    const t = c.firstAtOrAfter(fromMs);
    if (t !== null && (best === null || t < best)) best = t;
  }
  for (const c of caches) {
    if (c.firstAtOrAfter(fromMs) !== null) continue;
    const knownEmptyFarEnough = best === null ? c.knownUntil === Number.POSITIVE_INFINITY : c.knownUntil > best;
    if (!knownEmptyFarEnough) return { kind: 'unknown' };
  }
  return best === null ? { kind: 'none' } : { kind: 'at', ms: best };
}

/** Whether every cache holds all 1m candles revealed at `cursorMs`, so a step to it can be folded. */
export function coversReveal(caches: readonly TapeView[], cursorMs: number): boolean {
  return caches.every((c) => c.knownUntil > cursorMs - ONE_MINUTE_MS);
}
