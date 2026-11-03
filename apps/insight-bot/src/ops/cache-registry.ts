/**
 * IB-096 — every in-memory cache of the process, by name, so `/metrics` can say what each holds
 * (entries per key family, and how many of them are already expired but not yet dropped). The
 * point is attribution on a 1 GB box: "the bot is 300 MB" is not actionable, "positioning holds
 * 240 OI windows" is.
 */
export interface CacheStats {
  family: string;
  entries: number;
  expired: number;
}

export interface InspectableCache {
  stats(): CacheStats[];
}

const caches = new Map<string, InspectableCache>();

/** Later registrations under the same name replace earlier ones (a re-created service in a spec). */
export function registerCache(name: string, cache: InspectableCache): void {
  caches.set(name, cache);
}

export function cacheSnapshot(): Array<{ cache: string } & CacheStats> {
  return [...caches.entries()].flatMap(([cache, c]) => c.stats().map((s) => ({ cache, ...s })));
}

const PERIODS = new Set(['1h', '4h', '24h', '7d']);

/**
 * A key's family, the part that names WHAT is cached rather than which instance:
 * - window keys (`venue|market|symbol|tf|from|to`, `ttl-cache.ts`) → `venue|market|tf`;
 * - candle pages (`market:symbol:tf:pageStart`) → `candles:market:tf`;
 * - named keys (`positioning:24h`, `coingecko:markets:top`) → the name without a period.
 */
export function keyFamily(key: string): string {
  if (key.includes('|')) {
    const [venue, market, , tf] = key.split('|');
    return `${venue}|${market}|${tf}`;
  }
  const parts = key.split(':');
  if (parts.length === 4 && (parts[0] === 'perp' || parts[0] === 'spot') && /^\d+$/.test(parts[3])) return `candles:${parts[0]}:${parts[2]}`;
  return parts.filter((p) => !PERIODS.has(p) && !/^\d+$/.test(p)).join(':') || key;
}

/** Entries per family; `expiredAt` (optional) counts those past their expiry. */
export function familyStats<V>(entries: Iterable<[string, V]>, expired: (v: V) => boolean = () => false): CacheStats[] {
  const by = new Map<string, CacheStats>();
  for (const [key, v] of entries) {
    const family = keyFamily(key);
    const s = by.get(family) ?? { family, entries: 0, expired: 0 };
    s.entries++;
    if (expired(v)) s.expired++;
    by.set(family, s);
  }
  return [...by.values()];
}
