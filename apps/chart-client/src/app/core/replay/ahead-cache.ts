import type { Candle, CompactCandleTuple, InstrumentId } from '@trade-automation/contracts';

const ONE_MINUTE_MS = 60_000;

/**
 * backtest-app-system-design.md §5.3 — one panel's 1m tape in compact
 * `[openTime, o, h, l, c, v]` tuples, ascending.
 *
 * It knows exactly which range it covers: every stored 1m candle with
 * `knownFrom <= openTime < knownUntil` is in the cache, so "no candle here" means the tape really
 * has none, not that it has not been fetched. `knownUntil` is `Infinity` once the server has said
 * `endOfTape`. The engine keeps the 1m of the bar forming at the cursor (the "carry", from the
 * bucket's open) as well as everything ahead of it, so a step can fold the whole bucket again
 * with `foldOneMinute` exactly as the server does.
 */
export class AheadCache {
  private tuples: CompactCandleTuple[] = [];
  private head = 0;
  private from = 0;
  private until = 0;
  private ended = false;

  constructor(readonly instrument: InstrumentId) {}

  get knownFrom(): number {
    return this.from;
  }

  get knownUntil(): number {
    return this.ended ? Number.POSITIVE_INFINITY : this.until;
  }

  get endOfTape(): boolean {
    return this.ended;
  }

  /** Candles currently held. */
  get size(): number {
    return this.tuples.length - this.head;
  }

  /** Forget everything; knowledge starts (empty) at `fromMs`. */
  reset(fromMs: number): void {
    this.tuples = [];
    this.head = 0;
    this.from = fromMs;
    this.until = fromMs;
    this.ended = false;
  }

  /**
   * One `…/candles/ahead?fromMs=knownUntil` page. The server returns every candle from `fromMs` up
   * to the page limit and sets `endOfTape` exactly, so the known range grows to just past the
   * page's last candle, or to infinity at the end of the tape.
   */
  appendPage(page: readonly CompactCandleTuple[], endOfTape: boolean): void {
    for (const t of page) {
      if (t[0] >= this.until) this.tuples.push(t);
    }
    if (page.length > 0) this.until = Math.max(this.until, page[page.length - 1][0] + 1);
    if (endOfTape) this.ended = true;
  }

  /**
   * Extends the known range back to `fromMs` with `older`, the candles in `[fromMs, knownFrom)`
   * (a timeframe switch to a coarser bar whose bucket opens before the cache does).
   */
  prependRange(fromMs: number, older: readonly CompactCandleTuple[]): void {
    if (fromMs >= this.from) return;
    const fresh = older.filter((t) => t[0] >= fromMs && t[0] < this.from);
    this.tuples = [...fresh, ...this.tuples.slice(this.head)];
    this.head = 0;
    this.from = fromMs;
  }

  /** Earliest held `openTime >= ms`, or null when none is held (see `knownUntil` for why). */
  firstAtOrAfter(ms: number): number | null {
    const i = this.indexAtOrAfter(ms);
    return i < this.tuples.length ? this.tuples[i][0] : null;
  }

  /** Held candles with `openTime >= ms`. */
  countAtOrAfter(ms: number): number {
    return this.tuples.length - this.indexAtOrAfter(ms);
  }

  /** The 1m candles with `fromMs <= openTime` that are revealed at `upToMs` (`openTime + 60 000 <= upToMs`). */
  revealed(fromMs: number, upToMs: number): Candle[] {
    const out: Candle[] = [];
    for (let i = this.indexAtOrAfter(fromMs); i < this.tuples.length; i++) {
      const t = this.tuples[i];
      if (t[0] + ONE_MINUTE_MS > upToMs) break;
      out.push(tupleToCandle(t, this.instrument));
    }
    return out;
  }

  /** Discards candles with `openTime < ms`; the known range then starts at `ms`. */
  dropBefore(ms: number): void {
    if (ms <= this.from) return;
    this.head = this.indexAtOrAfter(ms);
    this.from = ms;
    if (this.until < ms) this.until = ms;
    if (this.head > 10_000 && this.head > this.tuples.length / 2) {
      this.tuples = this.tuples.slice(this.head);
      this.head = 0;
    }
  }

  private indexAtOrAfter(ms: number): number {
    let lo = this.head;
    let hi = this.tuples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tuples[mid][0] < ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** A stored 1m candle from its compact tuple (§5.3). */
export function tupleToCandle(t: CompactCandleTuple, instrument: InstrumentId): Candle {
  return {
    instrument,
    timeframe: '1m',
    openTime: t[0],
    open: t[1],
    high: t[2],
    low: t[3],
    close: t[4],
    volume: t[5],
    closed: true,
    source: 'storage',
  };
}
