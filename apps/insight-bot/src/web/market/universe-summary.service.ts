import type { WebUniverseSummaryResponse } from '@trade-automation/contracts';
import type { FetchLike } from '../../venues/binance/rest.base';
import { BinanceWeightTracker } from '../../venues/binance/binance-weight.tracker';
import { FuturesDataClient } from '../../venues/binance/futures-data.client';
import { assembleSummary, type SummarySymbol } from './universe-summary';
import {
  OiHistRowSchema, PremiumIndexSummaryRowSchema, Ticker24hRowSchema,
  type OiHistRow, type PremiumIndexSummaryRow, type Ticker24hRow,
} from './summary.payloads';

/**
 * The instrument page's symbol dropdown, read LIVE from Binance USD-M. Nothing is stored: this is
 * the on-demand direction of `tasks/wind-down.jsonl` (WD-008/WD-009), built ahead of that layer.
 * When WD-008 lands its `TtlCache` and `VenuesModule`, this service should move onto them.
 *
 * **Weight per refresh**, Binance's documented costs, not measured by us:
 *
 * | call | weight | count |
 * |---|---|---|
 * | `GET /fapi/v1/ticker/24hr` (all symbols) | 40 | 1 |
 * | `GET /fapi/v1/premiumIndex` (all symbols) | 10 | 1 |
 * | `GET /futures/data/openInterestHist?period=1h&limit=25` | 1 | one per symbol (up to 60, `SUMMARY_MAX`) |
 *
 * So about 50 `fapi` weight plus one `/futures/data` call per listed symbol (40 since IB-070) per refresh.
 *
 * **IB-BUG-026 — what is cached, and why not the answer.** Until 2026-11-04 this held ONE answer keyed by
 * the symbol list. Market asks with two lists a minute (positioning's 30 coins, the KPIs' `[BTC]`), and
 * the instrument picker with a third. Each request evicted the other's answer, so the venue was asked
 * twice a minute: measured on the slot, 2 `ticker/24hr` and 2 `premiumIndex` in each of 5 minutes, ≈ 100
 * fapi weight. Now:
 * - the two all-symbol reads are ONE snapshot per `CACHE_TTL_MS`, whatever list is asked. They do not
 *   depend on the list, so there is nothing to key them by. Concurrent first callers share one request.
 * - open interest is cached PER SYMBOL for the same TTL, a failed symbol included. Two lists sharing BTC
 *   ask the venue for BTC once, and a failing coin is not retried by every caller.
 * - each caller's rows are assembled from those, which is cheap and pure (`assembleSummary`).
 *
 * So however many tabs and lists, the venue sees at most one snapshot a minute (50 fapi weight, about 2 %
 * of the 2,400/min ceiling) and one OI call per distinct symbol a minute against the `/futures/data` limit.
 * Memory: the snapshot holds every USD-M symbol (804 tickers and 945 premium rows on 2026-11-04). The
 * schemas pass every venue field through, which measured ~490 KB of heap as parsed. So the snapshot
 * keeps only the fields `assembleSummary` reads (`slimTicker` / `slimPremium` / `slimOi`): ≈ 280 KB of heap,
 * measured 3 times with live venue rows. The per-symbol OI cache adds 25 small rows per universe symbol.
 */
export const CACHE_TTL_MS = 60_000;
/** WD-008's ceiling: above this much of the 2,400/min budget, live reads answer 503. */
export const WEIGHT_CEILING_1M = 1_800;
/** How many open-interest calls are in flight at once. */
const OI_CONCURRENCY = 5;

const TICKER_WEIGHT = 40;
const PREMIUM_WEIGHT = 10;

export class VenueUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VenueUnavailableError';
  }
}

export interface UniverseSummaryOptions {
  futuresBaseUrl: string;
  fetchImpl?: FetchLike;
  weight?: BinanceWeightTracker;
  now?: () => number;
}

export class UniverseSummaryService {
  private readonly fetchImpl: FetchLike;
  private readonly weight: BinanceWeightTracker;
  private readonly futuresData: FuturesDataClient;
  private readonly now: () => number;
  private snapshot: { at: number; tickers: Ticker24hRow[]; premium: PremiumIndexSummaryRow[] } | null = null;
  private snapshotInFlight: Promise<{ at: number; tickers: Ticker24hRow[]; premium: PremiumIndexSummaryRow[] }> | null = null;
  /** Per symbol: the rows, or null when the call failed (a dash, cached as long as a success). */
  private readonly oiCache = new Map<string, { at: number; rows: OiHistRow[] | null }>();
  private readonly oiInFlight = new Map<string, Promise<OiHistRow[] | null>>();

  constructor(private readonly options: UniverseSummaryOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
    this.weight = options.weight ?? new BinanceWeightTracker();
    this.now = options.now ?? Date.now;
    this.futuresData = new FuturesDataClient({
      baseUrl: options.futuresBaseUrl,
      weight: this.weight,
      fetchImpl: this.fetchImpl,
    });
  }

  /** The summary for these symbols, assembled from the shared snapshot and the per-symbol OI cache. */
  async summary(symbols: readonly SummarySymbol[]): Promise<WebUniverseSummaryResponse> {
    const snap = await this.venueSnapshot();
    // Open interest is per symbol and optional: a symbol whose call fails shows a dash.
    const listed = new Set(snap.tickers.map((t) => t.symbol));
    const oiBySymbol = await this.openInterest(symbols.filter((s) => listed.has(s.id)).map((s) => s.id));
    return {
      asOfMs: snap.at,
      venue: 'binance-perp',
      rows: assembleSummary(symbols, snap.tickers, snap.premium, oiBySymbol),
    };
  }

  /** IB-BUG-026: the two all-symbol reads, once per TTL for every caller and every list. */
  private async venueSnapshot(): Promise<{ at: number; tickers: Ticker24hRow[]; premium: PremiumIndexSummaryRow[] }> {
    if (this.snapshot && this.now() - this.snapshot.at < CACHE_TTL_MS) return this.snapshot;
    if (this.snapshotInFlight) return this.snapshotInFlight;
    const promise = this.readSnapshot().then((snap) => {
      this.snapshot = snap;
      return snap;
    }).finally(() => {
      if (this.snapshotInFlight === promise) this.snapshotInFlight = null;
    });
    this.snapshotInFlight = promise;
    return promise;
  }

  private async readSnapshot(): Promise<{ at: number; tickers: Ticker24hRow[]; premium: PremiumIndexSummaryRow[] }> {
    if (this.weight.used1m(this.now()) > WEIGHT_CEILING_1M) {
      throw new VenueUnavailableError(`Binance weight above ${WEIGHT_CEILING_1M}/min; not adding to it`);
    }
    // The two all-symbol calls are the list's backbone: without them there is nothing to show.
    const [tickers, premium] = await Promise.all([
      this.getArray('/fapi/v1/ticker/24hr', TICKER_WEIGHT, (row) => Ticker24hRowSchema.parse(row)),
      this.getArray('/fapi/v1/premiumIndex', PREMIUM_WEIGHT, (row) => PremiumIndexSummaryRowSchema.parse(row)),
    ]) as [Ticker24hRow[], PremiumIndexSummaryRow[]];
    return { at: this.now(), tickers: tickers.map(slimTicker), premium: premium.map(slimPremium) };
  }

  private async getArray<T>(path: string, weight: number, parse: (row: unknown) => T): Promise<T[]> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`${this.options.futuresBaseUrl.replace(/\/$/, '')}${path}`);
    } catch (error) {
      throw new VenueUnavailableError(`Binance ${path}: ${(error as Error).message}`);
    } finally {
      this.weight.recordCall(weight);
    }
    this.weight.recordFromHeaders(response.headers);
    if (!response.ok) throw new VenueUnavailableError(`Binance ${path}: HTTP ${response.status} ${response.statusText}`);
    const body = await response.json();
    if (!Array.isArray(body)) throw new VenueUnavailableError(`Binance ${path}: expected an array, got ${typeof body}`);
    // A row that fails its schema throws: a renamed field must be loud, not a column of dashes.
    return body.map(parse);
  }

  /** Per-symbol OI, from the cache when fresh; the misses fetched `OI_CONCURRENCY` at a time. */
  private async openInterest(ids: readonly string[]): Promise<Map<string, OiHistRow[]>> {
    const out = new Map<string, OiHistRow[]>();
    const now = this.now();
    const misses: string[] = [];
    const waits: Array<Promise<void>> = [];
    for (const id of ids) {
      const hit = this.oiCache.get(id);
      if (hit && now - hit.at < CACHE_TTL_MS) {
        if (hit.rows) out.set(id, hit.rows);
        continue;
      }
      const pending = this.oiInFlight.get(id);
      if (pending) waits.push(pending.then((rows) => { if (rows) out.set(id, rows); }));
      else misses.push(id);
    }
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < misses.length) {
        const id = misses[next++];
        const promise = this.fetchOi(id);
        this.oiInFlight.set(id, promise);
        try {
          const rows = await promise;
          this.oiCache.set(id, { at: this.now(), rows });
          if (rows) out.set(id, rows);
        } finally {
          this.oiInFlight.delete(id);
        }
      }
    };
    await Promise.all([...Array.from({ length: Math.min(OI_CONCURRENCY, misses.length) }, worker), ...waits]);
    return out;
  }

  private async fetchOi(id: string): Promise<OiHistRow[] | null> {
    try {
      const rows = await this.futuresData.fetchPage<unknown>({ endpoint: 'openInterestHist', symbol: id, period: '1h', limit: 25 });
      return rows.map((row) => slimOi(OiHistRowSchema.parse(row)));
    } catch {
      return null; // one coin's dash, not the list's failure
    }
  }
}

/** IB-BUG-026: only what `assembleSummary` reads, so the minute-long snapshot holds no unused venue fields. */
export function slimTicker(t: Ticker24hRow): Ticker24hRow {
  return { symbol: t.symbol, lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent };
}
export function slimPremium(p: PremiumIndexSummaryRow): PremiumIndexSummaryRow {
  return { symbol: p.symbol, lastFundingRate: p.lastFundingRate, nextFundingTime: p.nextFundingTime };
}
export function slimOi(o: OiHistRow): OiHistRow {
  return { symbol: o.symbol, sumOpenInterest: o.sumOpenInterest, timestamp: o.timestamp };
}
