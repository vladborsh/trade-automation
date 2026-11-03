import { familyStats, registerCache, type CacheStats, type InspectableCache } from '../ops/cache-registry';

/**
 * WD-008 — the on-demand layer's one cache: bounded, in memory, per process. Nothing it holds is
 * written anywhere; a restart starts cold, which is fine because every entry is a venue answer that
 * can be asked for again.
 *
 * - **Bounded by entries** (least recently used goes first), so a crawler walking every symbol and
 *   window cannot grow the process — the box has 1 GB.
 * - **One load per key at a time**: concurrent readers of a missing key share one venue request.
 * - **Failures are not cached**: a venue error reaches the caller, and the next read tries again;
 *   a caller can keep a partial answer out too (`cacheIf`).
 *
 * Keys come from `windowKey`, which snaps `from` down and `to` up to the series' step, so a page
 * polling with a drifting `to = now` keeps hitting one entry until its TTL runs out.
 */
export const DEFAULT_MAX_ENTRIES = 2_000;
/** IB-096: expired entries are swept on insert, at most this often. */
export const SWEEP_EVERY_MS = 10_000;
/**
 * IB-096: and on a timer, for a process nobody is reading. Measured on slot dev-3: after a warm
 * load and 3.5 h with no request, 237 entries were still held, all expired (the 1 h positioning
 * baselines among them), because the insert-time sweep needs an insert. Heap used 62 MB vs 45 MB
 * on a fresh idle (one occasion, a note).
 */
export const IDLE_SWEEP_MS = 60_000;

/** TTLs from the WD-008 task row. OI and long-short: the venue's own period is 5 minutes. */
export const FUNDING_TTL_MS = 60_000;
export const OI_LS_TTL_MS = 300_000;

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCacheOptions {
  maxEntries?: number;
  now?: () => number;
  /** IB-096: registered under this name for `/metrics` (entries per key family). */
  name?: string;
  /**
   * IB-096: also sweep on an unref'd timer this often, so an idle process lets go of what expired.
   * Off unless asked for: the process-wide caches pass `IDLE_SWEEP_MS`; a spec's cache needs no timer.
   */
  idleSweepMs?: number;
}

export class TtlCache implements InspectableCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(options: TtlCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error(`maxEntries must be a positive integer, got ${this.maxEntries}`);
    }
    if (options.name) registerCache(options.name, this);
    if (options.idleSweepMs !== undefined) {
      if (!(options.idleSweepMs > 0)) throw new Error(`idleSweepMs must be positive, got ${options.idleSweepMs}`);
      // unref: the timer never keeps the process (or a test run) alive on its own
      setInterval(() => this.sweep(), options.idleSweepMs).unref();
    }
  }

  /** IB-096: entries per key family, and how many are expired but not yet swept. */
  stats(): CacheStats[] {
    const now = this.now();
    return familyStats(this.entries.entries(), (e) => e.expiresAt <= now);
  }

  get size(): number {
    return this.entries.size;
  }

  get<V>(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // refresh recency: Map iteration order is insertion order, so re-insert at the end
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as V;
  }

  set<V>(key: string, value: V, ttlMs: number): void {
    if (!(ttlMs > 0)) throw new Error(`ttlMs must be positive, got ${ttlMs}`);
    this.entries.delete(key);
    this.sweep();
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /**
   * IB-096 — drops every expired entry. An expired entry used to leave only when its key was read
   * again, and most never are (a window key moves with `now`): measured on slot dev-3, 270 of 450
   * held OI/LS windows were expired, ~60 % of the cache's ~20 MB. Run on insert, at most once per
   * `SWEEP_EVERY_MS`, so a burst of inserts costs one pass, not one per insert; and on the idle timer.
   */
  sweep(): void {
    const now = this.now();
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = now;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }

  /**
   * The cached value, or `load()`'s — shared by everyone asking for `key` while it runs. `cacheIf`
   * keeps a partial answer (one venue of three failed) out of the cache, so the next read retries.
   */
  async getOrLoad<V>(key: string, ttlMs: number, load: () => Promise<V>, cacheIf: (value: V) => boolean = () => true): Promise<V> {
    const hit = this.get<V>(key);
    if (hit !== undefined) return hit;
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<V>;
    const promise = load()
      .then((value) => {
        if (cacheIf(value)) this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

export interface WindowKeyParts {
  venue: string;
  market: string;
  symbol: string;
  /** The series' step name (`1h`, `5m`, `funding`…) — part of the key, not only of the snapping. */
  tf: string;
  fromMs: number;
  toMs: number;
}

/** `(venue, market, symbol, tf, fromSnapped, toSnapped)`, with `from` floored and `to` ceiled to `stepMs`. */
export function windowKey(parts: WindowKeyParts, stepMs: number): string {
  if (!(stepMs > 0)) throw new Error(`stepMs must be positive, got ${stepMs}`);
  const from = Math.floor(parts.fromMs / stepMs) * stepMs;
  const to = Math.ceil(parts.toMs / stepMs) * stepMs;
  return [parts.venue, parts.market, parts.symbol, parts.tf, from, to].join('|');
}
